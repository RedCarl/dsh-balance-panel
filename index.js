/**
 * @local/dsh-balance-panel — Host half.
 *
 * Collects the signed-in DeepSeek account balance and the balances (or plan
 * usage) of every API provider this machine has a credential for, then serves
 * one JSON snapshot on `GET /plugins/balance-panel/state`.
 *
 * A credential-driven provider is discovered from `ctx.credentials.describe`
 * and, when a provider was added through Settings → Models, from the live
 * `llm-pi-ai` settings document. The signed-in account comes from
 * `ctx.deepseekAccount`, so no token ever reaches the browser.
 *
 * When a session finishes a turn (`agent/status` → idle) the snapshot is
 * refreshed shortly afterwards so the left-sidebar entry can show the latest
 * amount without a separate notification.
 *
 * The plugin also checks its own GitHub releases and can update a git checkout
 * on demand. Update checks are cached; the update endpoint uses the same browser
 * trust fence as the read-only snapshot route.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** Stable route used by the browser half. */
export const ROUTE = '/plugins/balance-panel/state';

/** GitHub release endpoint used by the one-click update flow. */
export const UPDATE_ROUTE = '/plugins/balance-panel/update';

/** Package identity and source repository. */
const PACKAGE_NAME = '@local/dsh-balance-panel';
const REPOSITORY = 'RedCarl/dsh-balance-panel';
const GITHUB_URL = 'https://github.com/RedCarl/dsh-balance-panel';
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const UPDATE_CACHE_MS = 30 * 60_000;

/** Public status endpoints used by the service-health section. */
const OPENCODE_STATUS_URL = 'https://status.opencode.ai/api/status';
const DEEPSEEK_STATUS_URL = 'https://status.deepseek.com/';
const STATUS_CACHE_MS = 60_000;
const STATUS_TIMEOUT_MS = 6_000;

/** Services required before the route can mount. */
export const inject = ['webServer'];

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_CHANGES = 6;

/** Fixed provider adapters, in display order. */
const ADAPTERS = [
  {
    id: 'deepseek',
    providerIds: ['deepseek-official', 'deepseek'],
    settingsNs: 'llm-deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    base: 'https://api.deepseek.com',
    modelHint: 'deepseek-chat',
    query: 'deepseek',
  },
  {
    id: 'opencode-go',
    providerIds: ['opencode-go'],
    settingsNs: 'llm-pi-ai',
    keyEnv: 'OPENCODE_GO_API_KEY',
    altKeyEnv: 'OPENCODE_API_KEY',
    base: 'https://opencode.ai/zen/go/v1',
    modelHint: 'opencode-go',
    query: 'opencode',
  },
  {
    id: 'moonshot',
    providerIds: ['moonshot', 'kimi', 'moonshot-ai'],
    keyEnv: 'MOONSHOT_API_KEY',
    base: 'https://api.moonshot.cn/v1',
    modelHint: 'kimi-latest',
    query: 'moonshot',
  },
  {
    id: 'zhipu',
    providerIds: ['zhipu', 'glm', 'zhipuai'],
    keyEnv: 'ZHIPU_API_KEY',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint: 'glm-4.5',
    query: 'zhipu',
  },
  {
    id: 'openrouter',
    providerIds: ['openrouter'],
    keyEnv: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1',
    modelHint: 'openrouter/auto',
    query: 'openrouter',
  },
];

/** Trim a URL's trailing slash. */
function trimUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/** Origin of a URL, or the trimmed value when it does not parse. */
function originOf(value) {
  const trimmed = trimUrl(value);
  if (trimmed === '') return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

/** Strip a trailing `/v1` so provider-specific roots can be appended. */
function apiRoot(value) {
  const trimmed = trimUrl(value);
  return /\/v1$/i.test(trimmed) ? trimmed.slice(0, -3) : trimmed;
}

/** Join an endpoint path onto a base URL. */
function joinUrl(base, path) {
  const root = trimUrl(base);
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${root}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Coerce a value to a finite number, or undefined. */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Decimal string from a number or decimal string. */
function dec(value, fallback) {
  const parsed = num(value);
  if (parsed === undefined) return fallback;
  return String(parsed);
}

/** Normalize a currency code. */
function currencyOf(value, fallback = 'CNY') {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  return value.trim().toUpperCase();
}

/** Read a dotted path out of plain JSON. */
function pathGet(value, path) {
  if (typeof path !== 'string' || path === '') return undefined;
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (/^\d+$/.test(part)) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(part)];
    } else {
      if (typeof current !== 'object') return undefined;
      current = current[part];
    }
  }
  return current;
}

/** Recursively look for a plausible amount field in an unknown JSON payload. */
function findAmount(value, depth = 0) {
  if (depth > 3 || value === null || typeof value !== 'object') return undefined;
  const keys = [
    'available_balance',
    'total_balance',
    'availableBalance',
    'totalBalance',
    'limit_remaining',
    'remaining',
    'balance',
    'credits',
    'amount',
  ];
  for (const key of keys) {
    const hit = num(value[key]);
    if (hit !== undefined) {
      return {
        amount: hit,
        currency: currencyOf(value.currency ?? value.unit, 'USD'),
      };
    }
  }
  for (const child of Object.values(value)) {
    const hit = findAmount(child, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Fetch a JSON endpoint with a timeout and an optional abort signal. */
async function fetchJson(url, headers, timeoutMs, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal !== undefined) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { ok: response.ok, status: response.status, body, text };
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

/** Parse DeepSeek's `/user/balance` reply. */
function parseDeepSeek(body) {
  const infos = body?.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) return undefined;
  const wallets = [];
  for (const info of infos) {
    const amount = num(info?.total_balance);
    if (amount === undefined) continue;
    wallets.push({
      currency: currencyOf(info?.currency, 'CNY'),
      amount: dec(info.total_balance),
      granted: num(info.granted_balance) === undefined ? undefined : dec(info.granted_balance),
      toppedUp: num(info.topped_up_balance) === undefined ? undefined : dec(info.topped_up_balance),
    });
  }
  return wallets.length === 0 ? undefined : { wallets };
}

/** Parse Moonshot's `/v1/users/me/balance` reply. */
function parseMoonshot(body) {
  const data = body?.data ?? body;
  const amount = num(data?.available_balance) ?? num(data?.balance) ?? num(data?.cash_balance);
  if (amount === undefined) return undefined;
  return {
    wallets: [
      {
        currency: currencyOf(data?.currency, 'CNY'),
        amount: dec(amount),
        granted: num(data?.voucher_balance) === undefined ? undefined : dec(data.voucher_balance),
        toppedUp: num(data?.cash_balance) === undefined ? undefined : dec(data.cash_balance),
      },
    ],
  };
}

/** Parse Zhipu's `/api/paas/v4/balance` reply. */
function parseZhipu(body) {
  const data = body?.data ?? body;
  const amount = num(data?.balance) ?? num(data?.total) ?? num(data?.available);
  if (amount === undefined) return undefined;
  return {
    wallets: [{ currency: currencyOf(data?.currency, 'CNY'), amount: dec(amount) }],
  };
}

/** Parse OpenRouter's `/api/v1/credits` reply. */
function parseOpenRouter(body) {
  const data = body?.data ?? body;
  const total = num(data?.total_credits);
  const used = num(data?.total_usage);
  let remaining;
  if (total !== undefined && used !== undefined) remaining = total - used;
  else remaining = num(data?.limit_remaining) ?? num(data?.remaining) ?? num(data?.credits);
  if (remaining === undefined) return undefined;
  return {
    wallets: [
      {
        currency: 'USD',
        amount: dec(Math.max(0, remaining)),
        granted: total === undefined ? undefined : dec(total),
        toppedUp: used === undefined ? undefined : dec(used),
        grantedLabel: 'credits',
        toppedUpLabel: 'used',
      },
    ],
  };
}

/** Parse opencode Go's `/zen/go/v1/usage` reply into plan windows. */
function parseOpencodeUsage(body) {
  const usage = body?.usage ?? body?.data?.usage ?? body?.data ?? body;
  const windows = {};
  for (const name of ['rolling', 'weekly', 'monthly']) {
    const raw = usage?.[name];
    if (raw === null || typeof raw !== 'object') continue;
    const percent = num(raw.percent);
    if (percent === undefined) continue;
    windows[name] = {
      percent: Math.max(0, Math.min(100, percent)),
      status: typeof raw.status === 'string' ? raw.status : 'ok',
      resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : undefined,
    };
  }
  if (Object.keys(windows).length === 0) return undefined;
  return { usage: windows };
}

/** Parse a New API gateway's subscription reply. */
function parseNewApiLimit(body) {
  const data = body?.data ?? body;
  return (
    num(data?.soft_limit_usd) ??
    num(data?.hard_limit_usd) ??
    num(data?.system_hard_limit_usd) ??
    num(data?.limit) ??
    num(data?.total_granted)
  );
}

/** Parse a New API gateway's usage reply (cents). */
function parseNewApiUsage(body) {
  const data = body?.data ?? body;
  const cents = num(data?.total_usage) ?? num(data?.totalUsage) ?? num(data?.usage);
  if (cents === undefined) return undefined;
  return cents / 100;
}

/** Pick the endpoint dialect from a configured endpoint or provider id. */
function queryForBase(baseURL, providerId) {
  const lower = String(baseURL ?? '').toLowerCase();
  const id = String(providerId ?? '').toLowerCase();
  if (lower.includes('api.deepseek.com') || id.includes('deepseek')) return 'deepseek';
  if (lower.includes('opencode.ai') || id.includes('opencode')) return 'opencode';
  if (lower.includes('moonshot') || id.includes('moonshot') || id.includes('kimi')) return 'moonshot';
  if (lower.includes('bigmodel') || id.includes('zhipu') || id.includes('glm')) return 'zhipu';
  if (lower.includes('openrouter')) return 'openrouter';
  return 'newapi';
}

/** Query one provider and normalize the outcome. */
async function queryProvider(adapter, options) {
  const { baseURL, apiKey, timeoutMs, signal } = options;
  const headers = { authorization: `Bearer ${apiKey}` };
  const kind = adapter.query;
  try {
    if (kind === 'deepseek') {
      const url = `${apiRoot(baseURL)}/user/balance`;
      const response = await fetchJson(url, headers, timeoutMs, signal);
      const parsed = response.ok ? parseDeepSeek(response.body) : undefined;
      if (parsed === undefined) {
        return { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'balance' };
      }
      return { ok: true, endpoint: url, kind: 'balance', ...parsed };
    }
    if (kind === 'moonshot') {
      const trimmed = trimUrl(baseURL);
      const url = /\/v1$/i.test(trimmed)
        ? `${trimmed}/users/me/balance`
        : `${trimmed}/v1/users/me/balance`;
      const response = await fetchJson(url, headers, timeoutMs, signal);
      const parsed = response.ok ? parseMoonshot(response.body) : undefined;
      if (parsed === undefined) {
        return { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'balance' };
      }
      return { ok: true, endpoint: url, kind: 'balance', ...parsed };
    }
    if (kind === 'zhipu') {
      const trimmed = trimUrl(baseURL);
      const url = /\/api\/paas\/v4$/i.test(trimmed)
        ? `${trimmed}/balance`
        : `${trimmed}/api/paas/v4/balance`;
      const response = await fetchJson(url, headers, timeoutMs, signal);
      const parsed = response.ok ? parseZhipu(response.body) : undefined;
      if (parsed === undefined) {
        return { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'balance' };
      }
      return { ok: true, endpoint: url, kind: 'balance', ...parsed };
    }
    if (kind === 'openrouter') {
      const trimmed = trimUrl(baseURL);
      const url = /\/api\/v1$/i.test(trimmed)
        ? `${trimmed}/credits`
        : `${trimmed}/api/v1/credits`;
      const response = await fetchJson(url, headers, timeoutMs, signal);
      const parsed = response.ok ? parseOpenRouter(response.body) : undefined;
      if (parsed === undefined) {
        return { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'balance' };
      }
      return { ok: true, endpoint: url, kind: 'balance', ...parsed };
    }
    if (kind === 'opencode') {
      const trimmed = trimUrl(baseURL);
      const url = /\/v1$/i.test(trimmed)
        ? `${trimmed}/usage`
        : `${trimmed}/zen/go/v1/usage`;
      const response = await fetchJson(url, headers, timeoutMs, signal);
      const parsed = response.ok ? parseOpencodeUsage(response.body) : undefined;
      if (parsed === undefined) {
        return { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'usage' };
      }
      return { ok: true, endpoint: url, kind: 'usage', ...parsed };
    }
    if (kind === 'newapi') {
      const origin = originOf(baseURL);
      const subscriptionUrl = `${origin}/dashboard/billing/subscription`;
      const subscription = await fetchJson(subscriptionUrl, headers, timeoutMs, signal);
      const limit = subscription.ok ? parseNewApiLimit(subscription.body) : undefined;
      if (limit === undefined) {
        return {
          ok: false,
          error: `HTTP ${subscription.status}`,
          endpoint: subscriptionUrl,
          kind: 'balance',
        };
      }
      const end = new Date().toISOString().slice(0, 10);
      const usageUrl = `${origin}/dashboard/billing/usage?start_date=2000-01-01&end_date=${end}`;
      const usageResponse = await fetchJson(usageUrl, headers, timeoutMs, signal);
      const used = usageResponse.ok ? parseNewApiUsage(usageResponse.body) : undefined;
      const remaining = limit - (used ?? 0);
      return {
        ok: true,
        endpoint: subscriptionUrl,
        kind: 'balance',
        wallets: [
          {
            currency: 'USD',
            amount: dec(Math.max(0, remaining)),
            granted: dec(limit),
            toppedUp: used === undefined ? undefined : dec(used),
            grantedLabel: 'limit',
            toppedUpLabel: 'used',
          },
        ],
      };
    }
    // Generic supplier: try a few common balance endpoints in order.
    const candidates = [
      { url: `${apiRoot(baseURL)}/user/balance`, parse: parseDeepSeek },
      {
        url: /\/v1$/i.test(trimUrl(baseURL))
          ? `${trimUrl(baseURL)}/users/me/balance`
          : `${trimUrl(baseURL)}/v1/users/me/balance`,
        parse: parseMoonshot,
      },
      {
        url: /\/api\/v1$/i.test(trimUrl(baseURL))
          ? `${trimUrl(baseURL)}/credits`
          : `${trimUrl(baseURL)}/api/v1/credits`,
        parse: parseOpenRouter,
      },
    ];
    let lastError = 'no supported balance endpoint';
    for (const candidate of candidates) {
      const response = await fetchJson(candidate.url, headers, timeoutMs, signal);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const parsed = candidate.parse(response.body);
      if (parsed !== undefined) {
        return { ok: true, endpoint: candidate.url, kind: 'balance', ...parsed };
      }
      const generic = findAmount(response.body);
      if (generic !== undefined) {
        return {
          ok: true,
          endpoint: candidate.url,
          kind: 'balance',
          wallets: [{ currency: generic.currency, amount: dec(generic.amount) }],
        };
      }
      lastError = 'unrecognized balance payload';
    }
    return { ok: false, error: lastError, kind: 'balance' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      kind: kind === 'opencode' ? 'usage' : 'balance',
    };
  }
}

/** Numeric semver parts; non-numeric suffixes are ignored. */
function versionParts(value) {
  return String(value ?? '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Whether `latest` is a newer release than `current`. */
function isNewerVersion(latest, current) {
  const left = versionParts(latest);
  const right = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return false;
}

/** Read a small JSON request body. */
async function readRequestBody(req, limit = 8192) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > limit) throw new Error('request body too large');
  }
  return text;
}

/** Decode the React Server Component stream embedded in a Next.js status page. */
function decodeNextStream(html) {
  const pattern = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  let match;
  let text = '';
  while ((match = pattern.exec(html)) !== null) {
    try {
      text += JSON.parse(match[1]);
    } catch {
      // Ignore a malformed segment and keep the rest.
    }
  }
  return text;
}

/** Read one balanced JSON object that starts after a marker. */
function readJsonObjectAfter(text, marker) {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(marker, from);
    if (at < 0) break;
    const start = text.indexOf('{', at + marker.length);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const ch = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return { value: JSON.parse(text.slice(start, index + 1)), end: index };
        }
      }
    }
    from = at + marker.length;
  }
  return undefined;
}

/** Severity order used to combine component statuses. */
const STATUS_RANK = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  full_outage: 4,
  outage: 4,
};

/** The most severe status in a list. */
function worstStatus(statuses) {
  let worst = 'operational';
  for (const status of statuses) {
    if ((STATUS_RANK[status] ?? 2) > (STATUS_RANK[worst] ?? 0)) worst = status;
  }
  return worst;
}

/** Short component name for a DeepSeek API component. */
function deepseekShortName(name) {
  return String(name ?? '')
    .replace(/^DeepSeek\s+/i, '')
    .replace(/\s*API服务\(API Service\)/i, ' API')
    .replace(/\s*服务\(API Service\)/i, ' API')
    .trim();
}

/** Parse the status page's server-rendered component data. */
function parseDeepSeekStatusHtml(html) {
  const stream = decodeNextStream(html);
  if (stream === '') throw new Error('DeepSeek status data is missing');
  let data;
  let from = 0;
  while (data === undefined) {
    const at = stream.indexOf('"initialData":', from);
    if (at < 0) break;
    const found = readJsonObjectAfter(stream, '"initialData":');
    if (found !== undefined && found.value?.page?.components !== undefined) {
      data = found.value;
      break;
    }
    from = at + 1;
  }
  if (data === undefined) throw new Error('DeepSeek status data is missing');
  const components = (Array.isArray(data.page.components) ? data.page.components : [])
    .filter((component) => component !== null && typeof component === 'object')
    .map((component) => ({
      id: typeof component.component_id === 'string' ? component.component_id : '',
      name: typeof component.name === 'string' ? component.name : '',
      status: 'operational',
    }));
  const byId = new Map(components.map((component) => [component.id, component]));
  const activeChanges = Array.isArray(data.active_changes) ? data.active_changes : [];
  for (const change of activeChanges) {
    const affected = Array.isArray(change?.affected_components) ? change.affected_components : [];
    for (const item of affected) {
      const component =
        byId.get(item?.component_id) ??
        components.find((candidate) => candidate.name === item?.name);
      if (component !== undefined && typeof item?.status === 'string') {
        component.status = item.status;
      }
    }
  }
  const updated = /"initialDataUpdatedAt":(\d+)/.exec(stream);
  return {
    ok: true,
    components,
    incidents: activeChanges.map((change) => ({
      title: typeof change?.title === 'string' ? change.title : '',
      status: typeof change?.status === 'string' ? change.status : '',
    })),
    updatedAt: updated === null ? Date.now() : Number(updated[1]),
  };
}

/** Loopback socket check used only when the Host connection service is absent. */
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') {
    return false;
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** Write one JSON response. */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

/** Normalize plugin config. */
function normalizeConfig(config) {
  const input = config !== null && typeof config === 'object' ? config : {};
  return {
    cacheTtlMs:
      typeof input.cacheTtlMs === 'number' && input.cacheTtlMs >= 5000
        ? input.cacheTtlMs
        : DEFAULT_CACHE_TTL_MS,
    timeoutMs:
      typeof input.timeoutMs === 'number' && input.timeoutMs >= 1000
        ? input.timeoutMs
        : DEFAULT_TIMEOUT_MS,
    locale: typeof input.locale === 'string' && input.locale !== '' ? input.locale : 'zh',
    sources: Array.isArray(input.sources) ? input.sources : [],
    showUnconfigured: input.showUnconfigured === true,
    autoRefreshAfterSession: input.autoRefreshAfterSession !== false,
  };
}

/** The balance panel Host plugin. */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  let cache;
  let cacheAt = 0;
  let cacheRequestKey = '';
  let inflight;
  let inflightKey = '';
  let buildSeq = 0;
  let lastRequested;
  let disposed = false;
  let sessionTimer;
  let lastAutoRefreshAt = 0;
  let sessionUpdate = { at: undefined, autoRefreshedAt: undefined, changes: [] };
  let sessionRefreshPending = false;
  let previousAmounts = new Map();
  const modelCache = new Map();
  let settingsCache = { at: 0, value: undefined };
  let updateCache = {
    at: 0,
    latestVersion: undefined,
    releaseUrl: undefined,
    publishedAt: undefined,
    error: undefined,
  };
  let updateInFlight = false;
  let opencodeStatusCache = { at: 0, value: undefined };
  let deepseekStatusCache = { at: 0, value: undefined };

  /** Read one settings namespace's live value, cached briefly. */
  const settingsValue = (ns) => {
    const now = Date.now();
    if (now - settingsCache.at > 5000) {
      let entries = [];
      try {
        entries = ctx.get('settings')?.describe?.({ redactSecrets: true }) ?? [];
      } catch {
        entries = [];
      }
      settingsCache = { at: now, value: Array.isArray(entries) ? entries : [] };
    }
    const entry = settingsCache.value.find((item) => item?.ns === ns);
    return entry?.value;
  };

  /** Read provider profiles declared in the pi-ai settings namespace. */
  const configuredProviders = () => {
    const map = new Map();
    const pi = settingsValue('llm-pi-ai');
    if (pi !== null && typeof pi === 'object' && pi.providers !== null && typeof pi.providers === 'object') {
      for (const [id, profile] of Object.entries(pi.providers)) {
        if (profile !== null && typeof profile === 'object') map.set(id, profile);
      }
    }
    const deepseek = settingsValue('llm-deepseek');
    if (deepseek !== null && typeof deepseek === 'object' && deepseek.apiKeyEnv !== undefined) {
      if (!map.has('deepseek-official')) map.set('deepseek-official', deepseek);
    }
    return map;
  };

  /** Resolve one credential reference. */
  const credentialValue = async (ref) => {
    if (typeof ref !== 'string' || ref === '') return '';
    try {
      const credentials = ctx.get('credentials');
      if (credentials !== undefined) {
        const hit = await credentials.resolve(ref);
        if (hit !== null && typeof hit === 'object' && typeof hit.value === 'string' && hit.value !== '') {
          return hit.value;
        }
      }
    } catch {
      // Fall through to the process environment.
    }
    if (typeof process !== 'undefined' && typeof process.env[ref] === 'string') return process.env[ref];
    return '';
  };

  /** Model catalogue with a short cache. */
  const modelsOf = async (provider) => {
    if (typeof provider !== 'string' || provider === '') return [];
    const cached = modelCache.get(provider);
    if (cached !== undefined) return cached;
    let models = [];
    try {
      const llm = ctx.get('llm');
      if (llm !== undefined) models = await llm.listModels(provider);
    } catch {
      models = [];
    }
    if (!Array.isArray(models)) models = [];
    modelCache.set(provider, models);
    return models;
  };

  /** Provider display name from the live LLM registry. */
  const providerName = (provider) => {
    try {
      const llm = ctx.get('llm');
      const found = llm?.listProviders?.()?.find((item) => item?.id === provider);
      if (found !== undefined && typeof found.name === 'string') return found.name;
    } catch {
      // Ignore.
    }
    return provider;
  };

  /**
   * Resolve the model the sidebar should describe: the active Session's model
   * when the browser supplies one, otherwise the configured default.
   * @param requested - provider/model read from the snapshot query.
   */
  const readModel = async (requested) => {
    let selection;
    if (requested !== undefined && typeof requested.provider === 'string' && requested.provider !== '') {
      selection = {
        provider: requested.provider,
        model: typeof requested.model === 'string' ? requested.model : '',
      };
    } else {
      try {
        selection = ctx.get('agentDefaultModel')?.currentSelection?.();
      } catch {
        selection = undefined;
      }
    }
    const provider = typeof selection?.provider === 'string' ? selection.provider : '';
    let id = typeof selection?.model === 'string' ? selection.model : '';
    const models = await modelsOf(provider);
    let model = models.find((item) => item?.id === id);
    if (id === '' && models.length > 0) {
      id = models[0].id;
      model = models[0];
    }
    return {
      provider,
      providerName: provider === '' ? '' : providerName(provider),
      id,
      name: typeof model?.name === 'string' && model.name !== '' ? model.name : id,
      effort: typeof selection?.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
    };
  };

  /** Model rows for one provider, current model first. */
  const modelsFor = async (provider, current) => {
    const models = await modelsOf(provider);
    const rows = [];
    for (const model of models) {
      if (typeof model?.id !== 'string') continue;
      rows.push({ id: model.id, name: typeof model.name === 'string' ? model.name : model.id });
    }
    if (current !== undefined && current.id !== '' && !rows.some((row) => row.id === current.id)) {
      rows.unshift({ id: current.id, name: current.name });
    }
    return rows.slice(0, 6);
  };

  /** The signed-in account as one source. */
  const readAccount = async () => {
    const account = ctx.get('deepseekAccount');
    const base = {
      id: 'account',
      kind: 'account',
      label: 'DeepSeek Account',
      provider: 'deepseek-account',
      providers: ['deepseek-account'],
      providerName: 'DeepSeek',
      status: 'unavailable',
      updatedAt: new Date().toISOString(),
    };
    if (account === undefined) return base;
    const client = {
      version: '1.0.0',
      locale: settings.locale,
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    };
    let state;
    try {
      state = await account.getState();
    } catch (error) {
      return { ...base, status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
    if (state?.status !== 'credential-stored') {
      return { ...base, status: 'signed-out', links: state?.links };
    }
    const [balance, profile] = await Promise.all([
      account.getBalance(client).catch(() => null),
      account.getProfile(client).catch(() => null),
    ]);
    if (balance === null || balance?.status !== 'ready') {
      return { ...base, status: 'error', error: 'balance unavailable' };
    }
    const profileValue = profile?.status === 'ready' ? profile.value : undefined;
    const wallets = [];
    for (const wallet of Array.isArray(balance.value) ? balance.value : []) {
      const amount = num(wallet?.balance);
      if (amount === undefined) continue;
      wallets.push({ currency: currencyOf(wallet.currency, 'CNY'), amount: dec(wallet.balance) });
    }
    for (const wallet of Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []) {
      const amount = num(wallet?.balance);
      if (amount === undefined || amount === 0) continue;
      wallets.push({
        currency: currencyOf(wallet.currency, 'CNY'),
        amount: dec(wallet.balance),
        bonus: true,
      });
    }
    return {
      ...base,
      status: 'ok',
      profile: {
        name: typeof profileValue?.name === 'string' ? profileValue.name : undefined,
        contact: typeof profileValue?.contact === 'string' ? profileValue.contact : undefined,
      },
      wallets,
      links: state.links,
    };
  };

  /** Read this package's version from the installed manifest. */
  const readLocalVersion = async () => {
    try {
      const manifest = JSON.parse(await readFile(join(PLUGIN_DIR, 'package.json'), 'utf8'));
      return typeof manifest.version === 'string' && manifest.version !== ''
        ? manifest.version
        : '0.0.0';
    } catch {
      return '0.0.0';
    }
  };

  /** Whether this installation is a git checkout. */
  const installMode = () => (existsSync(join(PLUGIN_DIR, '.git')) ? 'git' : 'bundle');

  /** Run one fixed git command inside the plugin checkout. */
  const runGit = async (args) =>
    execFileAsync('git', args, {
      cwd: PLUGIN_DIR,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

  /** Read the latest GitHub release (or tag when no release exists). */
  const fetchLatestRelease = async () => {
    const headers = { 'user-agent': 'dsh-balance-panel' };
    const response = await fetchJson(
      `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
      headers,
      settings.timeoutMs,
    );
    let tag = '';
    let releaseUrl = '';
    let publishedAt = '';
    if (response.ok) {
      const body = response.body;
      tag = typeof body?.tag_name === 'string' ? body.tag_name.replace(/^v/i, '') : '';
      releaseUrl = typeof body?.html_url === 'string' ? body.html_url : '';
      publishedAt = typeof body?.published_at === 'string' ? body.published_at : '';
    } else if (response.status === 404) {
      const tags = await fetchJson(
        `https://api.github.com/repos/${REPOSITORY}/tags?per_page=1`,
        headers,
        settings.timeoutMs,
      );
      const first = Array.isArray(tags.body) ? tags.body[0] : undefined;
      tag = typeof first?.name === 'string' ? first.name.replace(/^v/i, '') : '';
      releaseUrl = tag === '' ? GITHUB_URL : `${GITHUB_URL}/releases/tag/v${tag}`;
    } else {
      throw new Error(`GitHub HTTP ${response.status}`);
    }
    if (tag === '') throw new Error('GitHub release has no version tag');
    return { version: tag, releaseUrl: releaseUrl || GITHUB_URL, publishedAt };
  };

  /** Check GitHub, caching the latest release for a short while. */
  const checkUpdate = async (force) => {
    const currentVersion = await readLocalVersion();
    const now = Date.now();
    if (force || updateCache.at === 0 || now - updateCache.at > UPDATE_CACHE_MS) {
      try {
        const release = await fetchLatestRelease();
        updateCache = {
          at: now,
          latestVersion: release.version,
          releaseUrl: release.releaseUrl,
          publishedAt: release.publishedAt,
          error: undefined,
        };
      } catch (error) {
        updateCache = {
          at: now,
          latestVersion: undefined,
          releaseUrl: undefined,
          publishedAt: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const latestVersion = updateCache.latestVersion;
    return {
      ok: updateCache.error === undefined,
      currentVersion,
      latestVersion,
      available:
        typeof latestVersion === 'string' && isNewerVersion(latestVersion, currentVersion),
      releaseUrl: updateCache.releaseUrl,
      publishedAt: updateCache.publishedAt,
      mode: installMode(),
      checkedAt: new Date(updateCache.at).toISOString(),
      error: updateCache.error,
    };
  };

  /**
   * Reload this plugin entry after a git checkout changed on disk. The current
   * request has already been answered; disabling and re-enabling the entry lets
   * the Loader import the new Host code.
   */
  const scheduleSelfReload = () => {
    setTimeout(() => {
      void (async () => {
        try {
          const manager = ctx.get('pluginManager');
          if (manager === undefined) return;
          const entries = await manager.listPlugins();
          const entry = entries.find(
            (candidate) =>
              candidate.moduleName === PACKAGE_NAME && candidate.enabled !== false,
          );
          if (entry === undefined) return;
          try {
            await manager.setPluginEnabled(entry.entryId, false);
          } catch {
            // Keep going: a failed disable may still be enabled.
          }
          try {
            await manager.setPluginEnabled(entry.entryId, true);
          } catch {
            // The next page load reports the installed version.
          }
        } catch {
          // Best-effort reload; the client still reloads its bundle.
        }
      })();
    }, 1200);
  };

  /** Apply the latest release to the current installation. */
  const performUpdate = async () => {
    if (updateInFlight) throw new Error('an update is already running');
    updateInFlight = true;
    try {
      const check = await checkUpdate(true);
      if (!check.available) {
        return {
          ok: true,
          updated: false,
          from: check.currentVersion,
          to: check.latestVersion,
          mode: check.mode,
          message: 'already up to date',
        };
      }
      if (check.mode === 'git') {
        const origin = (await runGit(['remote', 'get-url', 'origin'])).stdout.trim();
        if (!origin.includes(REPOSITORY)) {
          throw new Error(`origin is not ${REPOSITORY}`);
        }
        const dirty = (await runGit(['status', '--porcelain'])).stdout.trim();
        if (dirty !== '') {
          throw new Error('the checkout has local changes; commit or stash them first');
        }
        await runGit(['pull', '--ff-only']);
        const to = await readLocalVersion();
        if (!isNewerVersion(to, check.currentVersion)) {
          return {
            ok: true,
            updated: false,
            from: check.currentVersion,
            to,
            mode: 'git',
            message: 'already up to date',
          };
        }
        scheduleSelfReload();
        return {
          ok: true,
          updated: true,
          from: check.currentVersion,
          to,
          mode: 'git',
          reload: true,
          latestVersion: check.latestVersion,
        };
      }
      const manager = ctx.get('pluginManager');
      if (manager === undefined) throw new Error('pluginManager is unavailable');
      // A tagged git spec differs from the recorded dependency, so the plugin
      // manager does not refuse it as already installed; pnpm updates the
      // dependency to that release and the manager reloads the bundle.
      const result = await manager.installBundle(
        `${GITHUB_URL}#v${check.latestVersion}`,
      );
      return {
        ok: result.application !== 'failed',
        updated: result.changed !== false && result.application !== 'failed',
        from: check.currentVersion,
        to: check.latestVersion,
        mode: 'bundle',
        application: result.application,
        restartReason: result.restartReason,
        warnings: result.warnings,
      };
    } finally {
      updateInFlight = false;
    }
  };

  /** Fetch text with the same timeout discipline as JSON calls. */
  const fetchText = async (url, headers, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/html', ...headers },
        signal: controller.signal,
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    } finally {
      clearTimeout(timer);
    }
  };

  /** Cached OpenCode status payload. */
  const loadOpenCodeStatus = async () => {
    if (Date.now() - opencodeStatusCache.at < STATUS_CACHE_MS) return opencodeStatusCache.value;
    try {
      const response = await fetchJson(
        OPENCODE_STATUS_URL,
        { 'user-agent': 'dsh-balance-panel' },
        Math.min(settings.timeoutMs, STATUS_TIMEOUT_MS),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!Array.isArray(response.body?.components)) {
        throw new Error('OpenCode status payload has no components');
      }
      opencodeStatusCache = { at: Date.now(), value: response.body };
    } catch (error) {
      opencodeStatusCache = {
        at: Date.now(),
        value: { ok: false, error: error instanceof Error ? error.message : String(error) },
      };
    }
    return opencodeStatusCache.value;
  };

  /** Cached DeepSeek status page data. */
  const loadDeepSeekStatus = async () => {
    if (Date.now() - deepseekStatusCache.at < STATUS_CACHE_MS) return deepseekStatusCache.value;
    try {
      const response = await fetchText(
        DEEPSEEK_STATUS_URL,
        { 'user-agent': 'dsh-balance-panel' },
        Math.min(settings.timeoutMs, STATUS_TIMEOUT_MS),
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      deepseekStatusCache = { at: Date.now(), value: parseDeepSeekStatusHtml(response.text) };
    } catch (error) {
      deepseekStatusCache = {
        at: Date.now(),
        value: { ok: false, error: error instanceof Error ? error.message : String(error) },
      };
    }
    return deepseekStatusCache.value;
  };

  /** Pick the OpenCode Go status and speed for the active model. */
  const buildOpenCodeStatus = (raw, current) => {
    if (raw === undefined || raw?.ok === false) {
      return { ok: false, error: raw?.error ?? 'OpenCode status unavailable' };
    }
    const go = (Array.isArray(raw.components) ? raw.components : []).find(
      (component) => component?.service === 'go',
    );
    if (go === undefined) return { ok: false, error: 'OpenCode Go status is missing' };
    const model = (Array.isArray(go.breakdown) ? go.breakdown : []).find(
      (item) => item?.id === current.id,
    );
    const speed =
      model?.speed !== undefined &&
      ((Number.isFinite(model.speed.ttft) && model.speed.ttft > 0) ||
        (Number.isFinite(model.speed.tps) && model.speed.tps > 0))
        ? model.speed
        : go.speed;
    return {
      ok: true,
      status: typeof model?.status === 'string' ? model.status : go.status,
      reason: typeof model?.reason === 'string' ? model.reason : go.reason,
      speed,
      model:
        model === undefined
          ? undefined
          : { id: model.id, status: model.status, reason: model.reason, speed: model.speed },
      models: go.models,
      updatedAt: raw.updatedAt,
      source: 'https://status.opencode.ai/',
    };
  };

  /** Pick the official DeepSeek component status for the active model. */
  const buildDeepSeekStatus = (raw, current) => {
    if (raw === undefined || raw?.ok === false) {
      return { ok: false, error: raw?.error ?? 'DeepSeek status unavailable' };
    }
    const components = Array.isArray(raw.components) ? raw.components : [];
    const overall = worstStatus(components.map((component) => component.status));
    const text = `${current.id ?? ''} ${current.name ?? ''}`.toLowerCase();
    const want = /pro|reasoner/.test(text) ? 'pro' : /flash|chat/.test(text) ? 'flash' : '';
    const component =
      want === ''
        ? undefined
        : components.find(
            (candidate) =>
              candidate.name.toLowerCase().includes(want) &&
              candidate.name.toLowerCase().includes('api'),
          );
    return {
      ok: true,
      status: component?.status ?? overall,
      overall,
      component:
        component === undefined
          ? undefined
          : {
              id: component.id,
              name: component.name,
              label: deepseekShortName(component.name),
              status: component.status,
            },
      components,
      incidents: raw.incidents,
      updatedAt: raw.updatedAt,
      source: 'https://status.deepseek.com/',
    };
  };

  /** Build the service-status section only for providers with a visible source. */
  const buildStatuses = async (current, sources) => {
    const wantsOpenCode = sources.some((source) => source.id === 'opencode-go');
    const wantsDeepSeek = sources.some(
      (source) => source.id === 'deepseek' || source.id === 'account',
    );
    if (!wantsOpenCode && !wantsDeepSeek) return {};
    const [opencode, deepseek] = await Promise.all([
      wantsOpenCode ? loadOpenCodeStatus() : undefined,
      wantsDeepSeek ? loadDeepSeekStatus() : undefined,
    ]);
    const status = {};
    if (wantsOpenCode) status.opencode = buildOpenCodeStatus(opencode, current);
    if (wantsDeepSeek) status.deepseek = buildDeepSeekStatus(deepseek, current);
    return status;
  };

  /** Build the complete snapshot for one refresh. */
  const buildSnapshot = async (reason, requested) => {
    const generatedAt = new Date().toISOString();
    const version = await readLocalVersion();
    const current = await readModel(requested);
    const profiles = configuredProviders();
    const sources = [];
    const usedProviders = new Set();
    const usedKeys = new Set();

    // 1. Signed-in account.
    const account = await readAccount();
    account.models = current.id === '' ? [] : [{ id: current.id, name: current.name }];
    // A signed-out account is not a balance source: do not surface an empty
    // "Account / Signed out" row in the sidebar or the page.
    if (account.status !== 'signed-out' && account.status !== 'unavailable') {
      sources.push(account);
    }

    // 2. Fixed providers with a credential.
    for (const adapter of ADAPTERS) {
      const profile =
        adapter.providerIds.map((id) => profiles.get(id)).find((item) => item !== undefined) ??
        (adapter.settingsNs === undefined ? undefined : settingsValue(adapter.settingsNs));
      const keyRef =
        (profile !== undefined && typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== ''
          ? profile.apiKeyEnv
          : adapter.keyEnv) ?? '';
      if (keyRef === '') continue;
      if (usedKeys.has(keyRef)) continue;
      const key = (await credentialValue(keyRef)) || (adapter.altKeyEnv ? await credentialValue(adapter.altKeyEnv) : '');
      // A route without a usable credential is not a balance source: do not
      // show an empty "Unavailable / missing credential" row.
      if (key === '' && !settings.showUnconfigured) continue;
      usedKeys.add(keyRef);
      const baseURL =
        trimUrl(profile?.baseURL) ||
        trimUrl(process.env[`${adapter.id.toUpperCase().replace(/-/g, '_')}_API_BASE`]) ||
        adapter.base;

      let result;
      if (key === '') {
        result = { ok: false, error: `missing credential ${keyRef}`, kind: adapter.query === 'opencode' ? 'usage' : 'balance' };
      } else {
        result = await queryProvider(adapter, {
          baseURL,
          apiKey: key,
          timeoutMs: settings.timeoutMs,
        });
      }
      const model =
        current.provider !== '' && adapter.providerIds.includes(current.provider)
          ? { id: current.id, name: current.name }
          : undefined;
      const models = await modelsFor(
        adapter.providerIds.find((id) => id === current.provider) ?? adapter.providerIds[0],
        model,
      );
      sources.push({
        id: adapter.id,
        kind: result.ok ? result.kind : adapter.query === 'opencode' ? 'usage' : 'balance',
        label: providerName(adapter.providerIds[0]) || adapter.id,
        provider: adapter.providerIds[0],
        providers: adapter.providerIds,
        providerName: providerName(adapter.providerIds[0]) || adapter.id,
        model: model?.id,
        modelName: model?.name,
        models: models.length > 0 ? models : model ? [model] : [],
        status: result.ok ? 'ok' : 'error',
        error: result.ok ? undefined : result.error,
        endpoint: result.endpoint,
        wallets: result.wallets,
        usage: result.usage,
        keyRef,
        baseURL,
        updatedAt: generatedAt,
      });
      for (const id of adapter.providerIds) usedProviders.add(id);
    }

    // 3. Providers added through Settings → Models (custom APIs).
    for (const [providerId, profile] of profiles) {
      if (usedProviders.has(providerId)) continue;
      if (profile === null || typeof profile !== 'object') continue;
      const keyRef = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : '';
      if (keyRef === '') continue;
      if (usedKeys.has(keyRef)) continue;
      const key = await credentialValue(keyRef);
      if (key === '' && !settings.showUnconfigured) continue;
      usedKeys.add(keyRef);
      const baseURL = trimUrl(profile.baseURL);
      const adapter = {
        id: providerId,
        query: baseURL === '' ? 'generic' : queryForBase(baseURL, providerId),
        providerIds: [providerId],
      };
      const result =
        key === '' || baseURL === ''
          ? {
              ok: false,
              error: key === '' ? `missing credential ${keyRef}` : 'this provider declares no baseURL',
              kind: 'balance',
            }
          : await queryProvider(adapter, {
              baseURL,
              apiKey: key,
              timeoutMs: settings.timeoutMs,
            });
      const model =
        current.provider === providerId ? { id: current.id, name: current.name } : undefined;
      const models = await modelsFor(providerId, model);
      sources.push({
        id: `provider:${providerId}`,
        kind: result.ok ? result.kind : 'balance',
        label:
          (typeof profile.displayName === 'string' && profile.displayName !== ''
            ? profile.displayName
            : providerName(providerId)) || providerId,
        provider: providerId,
        providers: [providerId],
        providerName: providerName(providerId) || providerId,
        model: model?.id,
        modelName: model?.name,
        models: models.length > 0 ? models : model ? [model] : [],
        status: result.ok ? 'ok' : 'error',
        error: result.ok ? undefined : result.error,
        endpoint: result.endpoint,
        wallets: result.wallets,
        usage: result.usage,
        keyRef,
        baseURL,
        updatedAt: generatedAt,
      });
      usedProviders.add(providerId);
    }

    // 4. Explicit sources from the plugin config.
    for (const [index, source] of settings.sources.entries()) {
      if (source === null || typeof source !== 'object') continue;
      const id = typeof source.id === 'string' && source.id !== '' ? source.id : `custom:${index}`;
      if (sources.some((item) => item.id === id)) continue;
      const keyRef = typeof source.apiKeyEnv === 'string' ? source.apiKeyEnv : '';
      const key = keyRef === '' ? '' : await credentialValue(keyRef);
      if (keyRef !== '' && key === '' && !settings.showUnconfigured) continue;
      const baseURL = trimUrl(source.baseURL);
      const kind =
        typeof source.kind === 'string' && source.kind !== ''
          ? source.kind
          : baseURL.includes('opencode.ai')
            ? 'opencode'
            : 'newapi';
      let result = { ok: false, error: 'source is not queryable', kind: 'balance' };
      if (baseURL !== '' && key !== '') {
        if (typeof source.endpoint === 'string' && source.endpoint !== '') {
          const url = joinUrl(baseURL, source.endpoint);
          try {
            const response = await fetchJson(
              url,
              { authorization: `Bearer ${key}` },
              settings.timeoutMs,
            );
            const amount = num(pathGet(response.body, source.amountPath));
            if (response.ok && amount !== undefined) {
              result = {
                ok: true,
                kind: 'balance',
                endpoint: url,
                wallets: [
                  {
                    currency: currencyOf(pathGet(response.body, source.currencyPath) ?? source.currency, 'CNY'),
                    amount: dec(amount),
                  },
                ],
              };
            } else {
              result = { ok: false, error: `HTTP ${response.status}`, endpoint: url, kind: 'balance' };
            }
          } catch (error) {
            result = {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              endpoint: url,
              kind: 'balance',
            };
          }
        } else {
          const adapter = {
            id,
            query: kind,
            providerIds: [typeof source.provider === 'string' ? source.provider : id],
          };
          result = await queryProvider(adapter, {
            baseURL,
            apiKey: key,
            timeoutMs: settings.timeoutMs,
          });
        }
      }
      sources.push({
        id,
        kind: result.ok ? result.kind : kind === 'opencode' ? 'usage' : 'balance',
        label: typeof source.label === 'string' && source.label !== '' ? source.label : id,
        provider: typeof source.provider === 'string' ? source.provider : id,
        providers: [typeof source.provider === 'string' ? source.provider : id],
        providerName: typeof source.label === 'string' ? source.label : id,
        model: typeof source.model === 'string' ? source.model : undefined,
        modelName: typeof source.modelName === 'string' ? source.modelName : source.model,
        models: typeof source.model === 'string' ? [{ id: source.model, name: source.modelName ?? source.model }] : [],
        status: result.ok ? 'ok' : 'error',
        error: result.ok ? undefined : result.error,
        endpoint: result.endpoint,
        wallets: result.wallets,
        usage: result.usage,
        keyRef,
        baseURL,
        updatedAt: generatedAt,
      });
    }

    const status = await buildStatuses(current, sources);

    // 5. Diff the amounts to build the session-update reminder.
    const nextAmounts = new Map();
    for (const source of sources) {
      const wallet = Array.isArray(source.wallets) ? source.wallets[0] : undefined;
      const value =
        wallet !== undefined
          ? num(wallet.amount)
          : source.usage?.monthly !== undefined
            ? 100 - num(source.usage.monthly.percent)
            : undefined;
      if (value !== undefined) nextAmounts.set(source.id, { value, source });
    }
    const changes = [];
    if (reason === 'session') {
      for (const [id, next] of nextAmounts) {
        const previous = previousAmounts.get(id);
        if (previous === undefined) continue;
        const delta = next.value - previous.value;
        if (Math.abs(delta) < 0.0001) continue;
        const wallet = Array.isArray(next.source.wallets) ? next.source.wallets[0] : undefined;
        changes.push({
          sourceId: id,
          label: next.source.label,
          model: next.source.model ?? next.source.modelName,
          currency: wallet?.currency,
          kind: next.source.kind,
          before: String(Number(previous.value.toFixed(4))),
          after: String(Number(next.value.toFixed(4))),
          delta: String(Number(delta.toFixed(4))),
        });
      }
      previousAmounts = nextAmounts;
      if (sessionUpdate.at === undefined) sessionUpdate.at = Date.now();
      sessionUpdate.autoRefreshedAt = Date.now();
      sessionUpdate.changes = changes.slice(0, MAX_CHANGES);
    } else if (previousAmounts.size === 0) {
      previousAmounts = nextAmounts;
    }

    return {
      ok: true,
      generatedAt,
      version,
      account: {
        status: account.status,
        name: account.profile?.name,
        contact: account.profile?.contact,
      },
      model: current,
      sources,
      status,
      sessionUpdate,
      cacheTtlMs: settings.cacheTtlMs,
    };
  };

  /** Read the snapshot, serving the cache unless forced or the requested model changed. */
  const getSnapshot = async (force, reason, requested) => {
    const now = Date.now();
    const requestKey = `${requested?.provider ?? ''}\u0000${requested?.model ?? ''}`;
    lastRequested = requested;
    if (
      !force &&
      cache !== undefined &&
      cacheRequestKey === requestKey &&
      now - cacheAt < settings.cacheTtlMs
    ) {
      return cache;
    }
    if (!force && inflight !== undefined && inflightKey === requestKey) return inflight;
    const effectiveReason = force && sessionRefreshPending ? 'session' : reason ?? 'poll';
    const seq = ++buildSeq;
    const pending = (async () => {
      try {
        const snapshot = await buildSnapshot(effectiveReason, requested);
        if (seq === buildSeq) {
          cache = snapshot;
          cacheAt = Date.now();
          cacheRequestKey = requestKey;
        }
        if (effectiveReason === 'session') sessionRefreshPending = false;
        return snapshot;
      } catch (error) {
        const failed = {
          ok: false,
          generatedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          sources: [],
          sessionUpdate,
        };
        if (seq === buildSeq) {
          cache = failed;
          cacheAt = Date.now();
          cacheRequestKey = requestKey;
        }
        return failed;
      }
    })();
    inflight = pending;
    inflightKey = requestKey;
    pending.finally(() => {
      if (inflight === pending) {
        inflight = undefined;
        inflightKey = '';
      }
    });
    return pending;
  };

  /** Note a finished turn and refresh soon, at most once every 10 seconds. */
  const noteSessionUpdate = () => {
    if (!settings.autoRefreshAfterSession || disposed) return;
    sessionUpdate = { ...sessionUpdate, at: Date.now(), changes: [] };
    sessionRefreshPending = true;
    if (sessionTimer !== undefined) return;
    const wait = Math.max(0, 10_000 - (Date.now() - lastAutoRefreshAt));
    sessionTimer = setTimeout(() => {
      sessionTimer = undefined;
      lastAutoRefreshAt = Date.now();
      cacheAt = 0;
      void getSnapshot(true, 'session', lastRequested);
    }, wait + 1200);
  };

  ctx.effect(() => () => {
    disposed = true;
    if (sessionTimer !== undefined) clearTimeout(sessionTimer);
  }, 'balance-panel: timer');

  ctx.effect(
    () =>
      ctx.on('agent/status', (payload) => {
        if (payload !== null && typeof payload === 'object' && payload.status === 'idle') {
          noteSessionUpdate();
        }
      }),
    'balance-panel: session update',
  );

  for (const event of [
    'credentials/reference-updated',
    'credentials/record-updated',
    'settings/document-updated',
    'deepseek-account/signed-out',
    'deepseek-account/session-expired',
    'llm/adapters-updated',
  ]) {
    ctx.effect(
      () =>
        ctx.on(event, () => {
          cacheAt = 0;
          settingsCache = { at: 0, value: undefined };
          if (event === 'llm/adapters-updated') modelCache.clear();
        }),
      `balance-panel: invalidate ${event}`,
    );
  }

  /** Apply the Host browser-trust fence to one route. */
  const rejectRequest = (req, res) => {
    const connection = ctx.get('connection');
    if (typeof connection?.requestRejection === 'function') {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) {
        sendJson(res, rejection, { ok: false, error: 'forbidden' });
        return true;
      }
      return false;
    }
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return true;
    }
    return false;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }
          if (rejectRequest(req, res)) return;
          let force = false;
          let requested = {};
          try {
            const params = new URL(String(req.url), 'http://localhost').searchParams;
            force = params.get('refresh') === '1';
            requested = {
              provider: params.get('provider') || undefined,
              model: params.get('model') || undefined,
            };
          } catch {
            force = false;
          }
          const snapshot = await getSnapshot(force, force ? 'manual' : 'poll', requested);
          sendJson(res, snapshot.ok === false ? 502 : 200, snapshot);
        },
      }),
    `balance-panel: GET ${ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: UPDATE_ROUTE,
        handler: async (req, res) => {
          if (rejectRequest(req, res)) return;

          if (req.method === 'GET' || req.method === 'HEAD') {
            let force = false;
            try {
              force = new URL(String(req.url), 'http://localhost').searchParams.get('force') === '1';
            } catch {
              force = false;
            }
            try {
              const state = await checkUpdate(force);
              sendJson(res, 200, state);
            } catch (error) {
              sendJson(res, 500, {
                ok: false,
                currentVersion: await readLocalVersion(),
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return;
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
            return;
          }

          const contentType = String(req.headers['content-type'] ?? '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
          if (contentType !== 'application/json') {
            sendJson(res, 415, { ok: false, error: 'content-type must be application/json' });
            return;
          }

          let payload;
          try {
            const text = await readRequestBody(req);
            payload = text === '' ? {} : JSON.parse(text);
          } catch (error) {
            sendJson(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : 'invalid request body',
            });
            return;
          }
          if (payload === null || typeof payload !== 'object' || payload.confirm !== true) {
            sendJson(res, 400, { ok: false, error: 'confirm: true is required' });
            return;
          }

          try {
            const result = await performUpdate();
            sendJson(res, result.ok === false ? 409 : 200, result);
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    `balance-panel: GET/POST ${UPDATE_ROUTE}`,
  );
}
