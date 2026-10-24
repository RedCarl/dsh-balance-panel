window.__ModuleLoader__.load({
  id: '@local/dsh-balance-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'balance-panel';
    /** Sidebar entry id and main-panel key. */
    const PANEL_ID = 'balance-panel';
    /** Host snapshot route. */
    const ROUTE = '/plugins/balance-panel/state';
    /** Client poll interval while the page is visible. */
    const POLL_MS = 15_000;

    const zh = {
      'entry.label': '余额',
      'page.title': '余额',
      'page.refreshTitle': '刷新余额',
      'page.current': '当前',
      'page.signedOut': '未登录',
      'page.signInHint': '在设置 → 账号登录后查看充值余额和赠金。',
      'page.unavailable': '不可用',
      'page.noBalance': '暂无余额',
      'page.noSources': '未发现余额来源',
      'page.noSourcesHint': '在设置 → 模型添加 API 密钥后会自动出现；也可以在插件配置中填写 sources。',
      'page.loading': '查询中…',
      'page.error': '余额查询失败',
      'page.retry': '重试',
      'page.granted': '赠送',
      'page.toppedUp': '充值',
      'page.credits': '总额度',
      'page.limit': '额度',
      'page.used': '已用',
      'page.usedShort': '已用',
      'page.leftShort': '余',
      'page.rollingShort': '5h',
      'page.weeklyShort': '周',
      'page.monthlyShort': '月',
      'page.updated': '更新于',
      'page.key': '密钥',
      'page.endpoint': '接口',
      'page.model': '模型',
      'page.localOnly': '余额在本机查询，密钥不会发送到浏览器。',
      'platform.account': '账号',
      'platform.deepseek': 'DeepSeek',
      'platform.opencode': 'OpenCode',
      'platform.moonshot': 'Moonshot',
      'platform.zhipu': '智谱',
      'platform.openrouter': 'OpenRouter',
      'pricing.peak': '峰时',
      'pricing.offPeak': '谷时',
      'pricing.standard': '标准价',
      'pricing.half': '5 折',
      'pricing.rule': '北京时间周一至周五 09:00–12:00、14:00–18:00 为峰时；周末与法定节假日全天谷时。',
      'status.ok': '正常',
      'status.error': '异常',
      'status.signed-out': '未登录',
      'status.missing-key': '缺少密钥',
      'status.unavailable': '不可用',
    };

    const en = {
      'entry.label': 'Balance',
      'page.title': 'Balance',
      'page.refreshTitle': 'Refresh balances',
      'page.current': 'Current',
      'page.signedOut': 'Signed out',
      'page.signInHint': 'Sign in from Settings → Account to see topped-up and granted balances.',
      'page.unavailable': 'Unavailable',
      'page.noBalance': 'No balance',
      'page.noSources': 'No balance source',
      'page.noSourcesHint': 'Add an API key in Settings → Models, or declare sources in the plugin config.',
      'page.loading': 'Loading…',
      'page.error': 'Balance query failed',
      'page.retry': 'Retry',
      'page.granted': 'Granted',
      'page.toppedUp': 'Topped up',
      'page.credits': 'Credits',
      'page.limit': 'Limit',
      'page.used': 'Used',
      'page.usedShort': 'used',
      'page.leftShort': 'left',
      'page.rollingShort': '5h',
      'page.weeklyShort': 'Week',
      'page.monthlyShort': 'Month',
      'page.updated': 'Updated',
      'page.key': 'Key',
      'page.endpoint': 'Endpoint',
      'page.model': 'Model',
      'page.localOnly': 'Balances are queried on this machine; API keys never reach the browser.',
      'platform.account': 'Account',
      'platform.deepseek': 'DeepSeek',
      'platform.opencode': 'OpenCode',
      'platform.moonshot': 'Moonshot',
      'platform.zhipu': 'Zhipu',
      'platform.openrouter': 'OpenRouter',
      'pricing.peak': 'Peak',
      'pricing.offPeak': 'Off-peak',
      'pricing.standard': 'Standard',
      'pricing.half': '50% off',
      'pricing.rule': 'Peak: Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time; weekends and holidays are off-peak all day.',
      'status.ok': 'OK',
      'status.error': 'Error',
      'status.signed-out': 'Signed out',
      'status.missing-key': 'Missing key',
      'status.unavailable': 'Unavailable',
    };

    const css = `
      .dsh-bal-page {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        line-height: 1.6;
      }
      .dsh-bal-inner {
        max-width: 720px;
        margin: 0 auto;
        padding: 28px clamp(18px, 4vw, 40px) 48px;
      }
      .dsh-bal-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .dsh-bal-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        line-height: 28px;
      }
      .dsh-bal-current {
        margin: 2px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-bal-refresh {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        display: grid;
        place-items: center;
        flex: none;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dsh-bal-refresh:hover {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-bal-refresh:disabled { opacity: .55; cursor: default; }
      .dsh-bal-refresh:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
        outline-offset: 1px;
      }
      .dsh-bal-list {
        margin: 18px 0 0;
        padding: 0;
        list-style: none;
        border-top: 0.5px solid var(--dsw-alias-border-l1);
      }
      .dsh-bal-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 2px 14px;
        padding: 13px 0;
        border-bottom: 0.5px solid var(--dsw-alias-border-l1);
      }
      .dsh-bal-platform {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        font-size: 13px;
        font-weight: 500;
        line-height: 20px;
      }
      .dsh-bal-platform-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-bal-dot {
        width: 6px;
        height: 6px;
        flex: none;
        border-radius: 50%;
        background: var(--dsw-alias-state-success-primary);
      }
      .dsh-bal-dot.warn { background: var(--dsw-alias-state-warn-primary); }
      .dsh-bal-dot.error { background: var(--dsw-alias-state-error-primary); }
      .dsh-bal-value {
        text-align: right;
        font-size: 15px;
        font-weight: 600;
        line-height: 20px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .dsh-bal-value.error { color: var(--dsw-alias-state-error-primary); }
      .dsh-bal-sub {
        grid-column: 1 / -1;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 17px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-bal-sub.error { color: var(--dsw-alias-state-error-primary); }
      .dsh-bal-empty {
        margin: 22px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
      }
      .dsh-bal-errorline {
        margin: 6px 0 0;
        color: var(--dsw-alias-state-error-primary);
        font-size: 11px;
        line-height: 17px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-bal-retry {
        margin-top: 10px;
        padding: 4px 12px;
        border: 0.5px solid var(--dsw-alias-border-l2);
        border-radius: 14px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .dsh-bal-retry:hover { background: var(--dsw-alias-bg-layer-2); }
      .dsh-bal-retry:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
        outline-offset: 1px;
      }
      @media (max-width: 560px) {
        .dsh-bal-inner { padding: 22px 16px 36px; }
      }
    `;

    /**
     * DeepSeek API peak/off-peak schedule. Official rule (checked 2026-10-23):
     * Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00 are peak; all
     * other times, including weekends and Chinese statutory holidays, are
     * off-peak. Off-peak prices are half of peak prices.
     *
     * Only the 2026 weekday holidays are listed; weekends already count as
     * off-peak, and make-up weekend workdays stay off-peak under the wording
     * "周末全天".
     */
    const HOLIDAYS_2026 = new Set([
      '2026-01-01',
      '2026-01-02',
      '2026-02-16',
      '2026-02-17',
      '2026-02-18',
      '2026-02-19',
      '2026-02-20',
      '2026-02-23',
      '2026-04-06',
      '2026-05-01',
      '2026-05-04',
      '2026-05-05',
      '2026-06-19',
      '2026-09-25',
      '2026-10-01',
      '2026-10-02',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);

    /** Two-digit month/day padding. */
    function pad2(value) {
      return value < 10 ? `0${value}` : `${value}`;
    }

    /**
     * Billing period at one instant, computed in fixed UTC+8 (no DST).
     * @param now - epoch milliseconds.
     * @returns 'peak' or 'off-peak'.
     */
    function computePricingPeriod(now = Date.now()) {
      const shifted = new Date(now + 8 * 60 * 60 * 1000);
      const year = shifted.getUTCFullYear();
      const month = shifted.getUTCMonth() + 1;
      const day = shifted.getUTCDate();
      const weekday = shifted.getUTCDay();
      const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
      const weekend = weekday === 0 || weekday === 6;
      if (weekend || HOLIDAYS_2026.has(dateKey)) return 'off-peak';
      const inPeakWindow =
        (minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60) ||
        (minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60);
      return inPeakWindow ? 'peak' : 'off-peak';
    }

    /** Tiny external store for the shared snapshot. */
    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get: () => state,
        set(next) {
          state = next;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }

    const initialPricing = computePricingPeriod();
    const store = createStore({
      status: 'idle',
      snapshot: null,
      error: null,
      refreshing: false,
      pricingPeriod: initialPricing,
    });

    let pricingPeriod = initialPricing;
    let loadGeneration = 0;
    let loadingCount = 0;
    let lastLoadedAt = 0;
    let translate = (key) => key;
    let labelSync = () => {};
    let labelText = '';
    let currentSnapshot = null;
    let activeSession = { sessionId: null, provider: null, model: null };
    let probeGeneration = 0;

    /** Translate with a fallback when the key is absent. */
    function tr(key, fallback) {
      const value = translate(key);
      return value === key ? fallback : value;
    }

    /** Format one amount with its currency symbol. */
    function fmtAmount(amount, currency) {
      const value = Number(amount);
      if (!Number.isFinite(value)) return String(amount ?? '');
      const code = typeof currency === 'string' && currency !== '' ? currency : 'CNY';
      const symbol =
        code === 'CNY' ? '¥' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `;
      return `${symbol}${value.toFixed(2)}`;
    }

    /** Platform for a provider id or route. */
    function platformFor(value) {
      const id = String(value ?? '').toLowerCase();
      if (id.includes('opencode')) return tr('platform.opencode', 'OpenCode');
      if (id.includes('moonshot') || id.includes('kimi')) return tr('platform.moonshot', 'Moonshot');
      if (id.includes('zhipu') || id.includes('glm')) return tr('platform.zhipu', 'Zhipu');
      if (id.includes('openrouter')) return tr('platform.openrouter', 'OpenRouter');
      if (id.includes('deepseek')) return tr('platform.deepseek', 'DeepSeek');
      return String(value ?? '');
    }

    /** Platform for one balance source. */
    function platformOf(source) {
      if (typeof source === 'string') return platformFor(source);
      if (source === null || source === undefined) return '';
      if (source.kind === 'account') return tr('platform.account', 'Account');
      const byProvider = platformFor(source.provider);
      if (byProvider !== source.provider) return byProvider;
      const byId = platformFor(source.id);
      if (byId !== source.id) return byId;
      return source.providerName || source.label || source.id || '';
    }

    /** Status dot tone for one source. */
    function statusTone(source) {
      if (source.status === 'ok') return '';
      if (source.status === 'error') return 'error';
      return 'warn';
    }

    /** Status copy used only in hover titles. */
    function statusText(source) {
      const key = `status.${source.status}`;
      const value = translate(key);
      return value === key ? source.status : value;
    }

    /** The source worth showing in the sidebar label and at the top. */
    function primarySource(snapshot) {
      const sources = snapshot?.sources ?? [];
      const ok = sources.filter((source) => source.status === 'ok');
      const provider = snapshot?.model?.provider;
      const matches = (source) =>
        source.provider === provider ||
        (Array.isArray(source.providers) && source.providers.includes(provider));
      const active = provider === undefined ? undefined : sources.find(matches);
      return (
        active ??
        ok.find((source) => source.kind === 'account') ??
        ok.find((source) => source.kind === 'balance') ??
        ok.find((source) => source.kind === 'usage') ??
        sources.find((source) => source.kind === 'account') ??
        ok[0]
      );
    }

    /** Compact amount for the sidebar label. */
    function labelAmount(source) {
      if (source === undefined) return '';
      if (source.status === 'signed-out') return tr('page.signedOut', 'Signed out');
      if (source.status === 'error') return tr('page.unavailable', 'Unavailable');
      const wallets = Array.isArray(source.wallets) ? source.wallets : [];
      if (wallets.length > 0) return fmtAmount(wallets[0].amount, wallets[0].currency);
      if (source.usage?.monthly !== undefined) {
        return `${Math.round(Math.max(0, 100 - Number(source.usage.monthly.percent)))}%`;
      }
      return tr('page.noBalance', 'No balance');
    }

    /** Whether this source bills at DeepSeek's official peak/off-peak prices. */
    function isDeepSeekPriced(source) {
      if (source === null || source === undefined) return false;
      if (source.kind === 'account') return source.status === 'ok';
      return (
        source.kind === 'balance' &&
        (source.id === 'deepseek' || source.provider === 'deepseek-official')
      );
    }

    /** Short period name for the sidebar label. */
    function pricingShort(period) {
      return period === 'peak' ? tr('pricing.peak', 'Peak') : tr('pricing.offPeak', 'Off-peak');
    }

    /** Current price strategy for one row: period plus the effective price. */
    function pricingDetail(period) {
      return period === 'peak'
        ? `${tr('pricing.peak', 'Peak')} · ${tr('pricing.standard', 'Standard')}`
        : `${tr('pricing.offPeak', 'Off-peak')} · ${tr('pricing.half', '50% off')}`;
    }

    /** Recompute the period and update the store/label when it flips. */
    function refreshPricing() {
      const next = computePricingPeriod();
      if (next === pricingPeriod) return;
      pricingPeriod = next;
      store.set({ ...store.get(), pricingPeriod: next });
      syncLabel(currentSnapshot);
    }

    /** Compute the compact sidebar label: platform and balance, never a model. */
    function computeLabel(snapshot) {
      if (snapshot === null || snapshot === undefined || snapshot.ok === false) {
        return tr('entry.label', 'Balance');
      }
      const primary = primarySource(snapshot);
      if (primary === undefined) return tr('entry.label', 'Balance');
      const platform = platformOf(primary);
      const amount = labelAmount(primary);
      const pricing = isDeepSeekPriced(primary) ? ` · ${pricingShort(pricingPeriod)}` : '';
      return amount === ''
        ? `${platform}${pricing}`
        : `${platform} · ${amount}${pricing}`;
    }

    /** Publish a new label to the sidebar when it actually changed. */
    function syncLabel(snapshot) {
      if (snapshot !== null && snapshot !== undefined) currentSnapshot = snapshot;
      const next = computeLabel(currentSnapshot);
      if (next === labelText) return;
      labelText = next;
      labelSync();
    }

    /** Apply the active Session's model to the next request. */
    function setActiveSession(next) {
      const changed =
        activeSession.sessionId !== next.sessionId ||
        activeSession.provider !== next.provider ||
        activeSession.model !== next.model;
      activeSession = next;
      if (changed) void load(true);
    }

    /** Forget the active Session once its probe really unmounted. */
    function clearActiveSession(sessionId) {
      if (activeSession.sessionId !== sessionId) return;
      activeSession = { sessionId: null, provider: null, model: null };
      void load(true);
    }

    /** Read the host snapshot for the active Session's model. */
    async function load(force) {
      const now = Date.now();
      if (!force && (loadingCount > 0 || now - lastLoadedAt < 4000)) return;
      const generation = ++loadGeneration;
      loadingCount += 1;
      lastLoadedAt = now;
      const previous = store.get();
      store.set({
        ...previous,
        refreshing: true,
        status: previous.snapshot ? previous.status : 'loading',
      });

      const params = new URLSearchParams();
      if (activeSession.provider !== null) params.set('provider', activeSession.provider);
      if (activeSession.model !== null) params.set('model', activeSession.model);
      if (force) params.set('refresh', '1');
      const url = `${ROUTE}${params.toString() === '' ? '' : `?${params.toString()}`}`;

      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        const snapshot = await response.json().catch(() => null);
        if (generation !== loadGeneration) return;
        if (snapshot === null || typeof snapshot !== 'object') {
          throw new Error(`HTTP ${response.status}`);
        }
        const current = store.get();
        const keepPrevious = snapshot.ok === false && current.snapshot !== null;
        store.set({
          ...current,
          refreshing: false,
          status: snapshot.ok === false ? (current.snapshot ? 'ready' : 'error') : 'ready',
          snapshot: keepPrevious ? current.snapshot : snapshot,
          error: snapshot.ok === false ? snapshot.error ?? null : null,
        });
        syncLabel(keepPrevious ? current.snapshot : snapshot);
      } catch (error) {
        if (generation !== loadGeneration) return;
        const current = store.get();
        store.set({
          ...current,
          refreshing: false,
          status: current.snapshot ? 'ready' : 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        loadingCount -= 1;
        if (generation === loadGeneration) {
          const current = store.get();
          if (current.refreshing) store.set({ ...current, refreshing: false });
        }
      }
    }

    /** Subscribe a component to the shared store. */
    function useStore() {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /** One small wallet glyph for the sidebar entry. */
    function BalanceIcon({ size = 18 }) {
      const state = useStore();
      const primary = primarySource(state.snapshot);
      const showPricing = isDeepSeekPriced(primary);
      const pricing = state.pricingPeriod;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', {
          x: 2.75,
          y: 6.25,
          width: 18.5,
          height: 13.5,
          rx: 3.2,
          stroke: 'currentColor',
          strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M2.75 10.25h18.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          opacity: 0.85,
        }),
        h('path', {
          d: 'M15.1 14.75h1.9',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        showPricing
          ? pricing === 'peak'
            ? h(
                'g',
                { 'aria-hidden': true },
                h('circle', {
                  cx: 4.7,
                  cy: 4.5,
                  r: 1.9,
                  fill: 'var(--dsw-alias-state-warn-primary)',
                }),
                h('path', {
                  d: 'M4.7 1.2v1.2M4.7 6.6v1.2M1.4 4.5h1.2M6.8 4.5h1.2M2.4 2.2l.9.9M7 2.2l-.9.9',
                  stroke: 'var(--dsw-alias-state-warn-primary)',
                  strokeWidth: 0.85,
                  strokeLinecap: 'round',
                }),
              )
            : h('path', {
                d: 'M6.3 1.8a3.5 3.5 0 1 0 3.1 5.9 2.9 2.9 0 0 1-3.1-5.9Z',
                fill: 'var(--dsw-alias-state-success-primary)',
                'aria-hidden': true,
              })
          : null,
      );
    }

    /**
     * Invisible session-scoped probe. It runs in the composer dock, reads the
     * active Session's durable model selection, and tells the sidebar which
     * provider/model is current. Rendering nothing keeps the dock unchanged.
     */
    function SessionProbe(props) {
      // The dock owner supplies session-standard props. If a composition omits
      // them, render nothing and let the periodic check use the default model.
      if (typeof props?.useProjection !== 'function') return null;
      return h(SessionProbeBody, props);
    }

    function SessionProbeBody({ sessionId, useProjection }) {
      const projection = useProjection('modelSelection');
      const next = projection?.next ?? null;
      const provider = next?.provider ?? null;
      const model = next?.model ?? null;
      React.useEffect(() => {
        const generation = ++probeGeneration;
        setActiveSession({ sessionId: sessionId ?? null, provider, model });
        return () => {
          window.setTimeout(() => {
            if (probeGeneration === generation) clearActiveSession(sessionId ?? null);
          }, 0);
        };
      }, [sessionId, provider, model]);
      return null;
    }

    /** Hover detail for one row. */
    function rowTooltip(source, pricing) {
      const parts = [];
      if (isDeepSeekPriced(source)) {
        parts.push(pricingDetail(pricing));
        parts.push(tr('pricing.rule', 'DeepSeek peak/off-peak schedule.'));
      }
      if (source.kind === 'account' && source.profile?.name) parts.push(source.profile.name);
      if (Array.isArray(source.models) && source.models.length > 0) {
        parts.push(
          `${tr('page.model', 'Model')}: ${source.models
            .slice(0, 3)
            .map((model) => model.id)
            .join(', ')}`,
        );
      }
      if (source.keyRef) parts.push(`${tr('page.key', 'Key')}: ${source.keyRef}`);
      if (source.endpoint) {
        try {
          parts.push(`${tr('page.endpoint', 'Endpoint')}: ${new URL(source.endpoint).host}`);
        } catch {
          // Ignore a malformed endpoint.
        }
      }
      if (source.updatedAt) {
        const date = new Date(source.updatedAt);
        if (!Number.isNaN(date.valueOf())) {
          parts.push(`${tr('page.updated', 'Updated')}: ${date.toLocaleTimeString()}`);
        }
      }
      if (source.status === 'signed-out') parts.push(tr('page.signInHint', 'Sign in to view balances.'));
      if (source.error) parts.push(source.error);
      parts.push(statusText(source));
      return parts.join(' · ');
    }

    /** Copy for a wallet sub-amount. */
    function walletPartLabel(kind) {
      if (kind === 'credits') return tr('page.credits', 'Credits');
      if (kind === 'limit') return tr('page.limit', 'Limit');
      if (kind === 'used') return tr('page.used', 'Used');
      if (kind === 'toppedUp') return tr('page.toppedUp', 'Topped up');
      return tr('page.granted', 'Granted');
    }

    /** Main amount for one row. */
    function rowValue(source) {
      if (source.status === 'signed-out') return tr('page.signedOut', 'Signed out');
      if (source.status === 'error') return tr('page.unavailable', 'Unavailable');
      if (source.status !== 'ok') return tr('page.noBalance', 'No balance');
      const wallets = Array.isArray(source.wallets) ? source.wallets : [];
      if (wallets.length > 0) {
        return fmtAmount(wallets[0].amount, wallets[0].currency);
      }
      if (source.usage?.monthly !== undefined) {
        return `${Math.round(Math.max(0, 100 - Number(source.usage.monthly.percent)))}% ${tr('page.leftShort', 'left')}`;
      }
      return tr('page.noBalance', 'No balance');
    }

    /** Secondary line for one row. */
    function rowSub(source, pricing) {
      const pricingText = isDeepSeekPriced(source) ? pricingDetail(pricing) : '';
      if (source.status === 'error') {
        return [pricingText, source.error ?? ''].filter(Boolean).join(' · ');
      }
      if (source.status !== 'ok') return pricingText;
      const usage = source.usage;
      if (usage !== undefined) {
        const windowText = (name, label) => {
          const window = usage[name];
          return window === undefined || window === null
            ? ''
            : `${label} ${Math.round(Number(window.percent))}%`;
        };
        const windows = [
          windowText('rolling', tr('page.rollingShort', '5h')),
          windowText('weekly', tr('page.weeklyShort', 'Week')),
          windowText('monthly', tr('page.monthlyShort', 'Month')),
        ]
          .filter(Boolean)
          .join(' · ');
        return windows === '' ? '' : `${tr('page.usedShort', 'used')} ${windows}`;
      }
      const wallets = Array.isArray(source.wallets) ? source.wallets : [];
      if (wallets.length === 0) return '';
      const first = wallets[0];
      const parts = [];
      if (first.granted !== undefined && Number(first.granted) > 0) {
        parts.push(
          `${walletPartLabel(first.grantedLabel)} ${fmtAmount(first.granted, first.currency)}`,
        );
      }
      if (first.toppedUp !== undefined && Number(first.toppedUp) > 0) {
        parts.push(
          `${walletPartLabel(first.toppedUpLabel ?? 'toppedUp')} ${fmtAmount(first.toppedUp, first.currency)}`,
        );
      }
      const bonus = wallets.find((wallet) => wallet.bonus === true);
      if (bonus !== undefined) {
        parts.push(`${tr('page.granted', 'Granted')} ${fmtAmount(bonus.amount, bonus.currency)}`);
      }
      // The topped-up amount is usually the same as the shown total; do not
      // repeat it under the row.
      const repeat =
        parts.length === 1 &&
        Number(first.toppedUp) === Number(first.amount) &&
        (first.granted === undefined || Number(first.granted) === 0);
      return [pricingText, ...(repeat ? [] : parts)].filter(Boolean).join(' · ');
    }

    /** One platform row on the balance page. */
    function BalanceRow({ source, pricing }) {
      const tone = statusTone(source);
      const sub = rowSub(source, pricing);
      return h(
        'li',
        { className: 'dsh-bal-row', title: rowTooltip(source, pricing) },
        h(
          'div',
          { className: 'dsh-bal-platform' },
          h('span', { className: `dsh-bal-dot ${tone}`, 'aria-hidden': true }),
          h('span', { className: 'dsh-bal-platform-name' }, platformOf(source)),
        ),
        h('div', { className: `dsh-bal-value ${tone}`, title: statusText(source) }, rowValue(source)),
        sub === '' ? null : h('div', { className: `dsh-bal-sub ${tone}` }, sub),
      );
    }

    /** The full balance page registered in the `main` slot. */
    function BalancePage() {
      const state = useStore();
      const snapshot = state.snapshot;
      const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
      const model = snapshot?.model;
      const provider = model?.provider;
      const orderedSources =
        provider === undefined
          ? sources
          : [...sources].sort((left, right) => {
              const rank = (source) =>
                source.provider === provider ||
                (Array.isArray(source.providers) && source.providers.includes(provider))
                  ? 0
                  : 1;
              return rank(left) - rank(right);
            });
      React.useEffect(() => {
        void load(false);
      }, []);

      const refresh = () => {
        void load(true);
      };

      const currentText =
        model !== undefined && model !== null && (model.name || model.id)
          ? model.name || model.id
          : '';

      return h(
        'section',
        { className: 'dsh-bal-page', 'aria-label': tr('page.title', 'Balance') },
        h('style', { 'data-plugin': '@local/dsh-balance-panel' }, css),
        h(
          'div',
          { className: 'dsh-bal-inner' },
          h(
            'header',
            { className: 'dsh-bal-head' },
            h(
              'div',
              { style: { minWidth: 0 } },
              h(
                'h1',
                { className: 'dsh-bal-title', title: tr('page.localOnly', 'Local-only balances.') },
                tr('page.title', 'Balance'),
              ),
              currentText === ''
                ? null
                : h(
                    'p',
                    { className: 'dsh-bal-current' },
                    `${tr('page.current', 'Current')} ${currentText}`,
                  ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-bal-refresh',
                onClick: refresh,
                disabled: state.refreshing,
                title: tr('page.refreshTitle', 'Refresh balances'),
                'aria-label': tr('page.refreshTitle', 'Refresh balances'),
              },
              h(
                'svg',
                { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
                h('path', {
                  d: 'M20 11a8 8 0 1 0-2.34 5.66',
                  stroke: 'currentColor',
                  strokeWidth: 1.7,
                  strokeLinecap: 'round',
                }),
                h('path', {
                  d: 'M20 5v6h-6',
                  stroke: 'currentColor',
                  strokeWidth: 1.7,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                }),
              ),
            ),
          ),
          state.status === 'loading' && snapshot === null
            ? h('p', { className: 'dsh-bal-empty' }, tr('page.loading', 'Loading…'))
            : null,
          state.status === 'error' && (snapshot === null || sources.length === 0)
            ? h(
                'div',
                { className: 'dsh-bal-empty' },
                h('div', null, tr('page.error', 'Balance query failed')),
                state.error === null
                  ? null
                  : h('p', { className: 'dsh-bal-errorline', title: state.error }, state.error),
                h(
                  'button',
                  { type: 'button', className: 'dsh-bal-retry', onClick: refresh },
                  tr('page.retry', 'Retry'),
                ),
              )
            : null,
          state.error !== null && snapshot !== null && sources.length > 0
            ? h('p', { className: 'dsh-bal-errorline', title: state.error }, state.error)
            : null,
          snapshot !== null && sources.length > 0
            ? h(
                'ul',
                { className: 'dsh-bal-list' },
                orderedSources.map((source) =>
                  h(BalanceRow, { source, pricing: state.pricingPeriod, key: source.id }),
                ),
              )
            : null,
          snapshot !== null &&
          sources.length === 0 &&
          state.status !== 'loading' &&
          state.status !== 'error'
            ? h(
                'p',
                { className: 'dsh-bal-empty', title: tr('page.noSourcesHint', 'Add an API key.') },
                tr('page.noSources', 'No balance source'),
              )
            : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'balance-panel: dictionaries');
        translate = ctx.locale.bind(NS);

        let entryDisposer = null;
        let entryActive = false;

        const registerEntry = () => {
          entryDisposer = ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 5,
              locale: NS,
              label: () => computeLabel(currentSnapshot) || tr('entry.label', 'Balance'),
            },
            BalanceIcon,
          );
        };

        labelSync = () => {
          if (!entryActive) return;
          if (entryDisposer !== null) {
            const dispose = entryDisposer;
            entryDisposer = null;
            dispose();
          }
          registerEntry();
        };

        ctx.slots.inject('sidebar.panellist', () => {
          entryActive = true;
          registerEntry();
          return () => {
            entryActive = false;
            if (entryDisposer !== null) {
              const dispose = entryDisposer;
              entryDisposer = null;
              dispose();
            }
          };
        });

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, BalancePage),
        );

        // Invisible probe in the open Session's composer dock: follows model
        // switches and Session switches so the sidebar balance is re-queried.
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'balance-panel-session',
              order: -100,
              locale: NS,
            },
            SessionProbe,
          ),
        );

        ctx.effect(() => {
          refreshPricing();
          void load(false);
          const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load(false);
          }, POLL_MS);
          const pricingInterval = window.setInterval(refreshPricing, 30_000);
          const onVisible = () => {
            if (document.visibilityState === 'visible') {
              refreshPricing();
              void load(false);
            }
          };
          const onFocus = () => {
            refreshPricing();
            void load(false);
          };
          document.addEventListener('visibilitychange', onVisible);
          window.addEventListener('focus', onFocus);
          return () => {
            window.clearInterval(interval);
            window.clearInterval(pricingInterval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onFocus);
          };
        }, 'balance-panel: polling');
      },
    };
  },
});
