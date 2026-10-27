# 余额与用量（Balance & Usage）

在左侧栏「自动化任务」同一区域增加一个**余额**入口：入口文字显示**平台 + 余额**（不显示模型名称），例如
`OpenCode · 99%`、`DeepSeek · ¥331.11`。它跟随当前会话选中的模型：切模型或切会话后立即重新查询；没有会话时回退到默认模型。点击后打开完整面板，按来源列出：

- **登录账号**：DeepSeek 账号的充值余额与赠金余额（未登录时不显示）。
- **OpenCode Go 套餐**：5 小时 / 本周 / 本月三档用量与重置时间。
- **DeepSeek / Moonshot / 智谱 / OpenRouter**：配置了对应环境变量或凭据后自动出现。
- **设置 → 模型里添加的自定义 API**：带 `baseURL` 的 OpenAI 兼容网关按 New API 的
  `/dashboard/billing/subscription` + `/dashboard/billing/usage` 计算余额。
- **插件配置里的 `sources`**：完全自定义端点、金额 JSON 路径和币种。

## 安装（无需 npm）

直接从 GitHub 安装（推荐）：

```sh
dsh plugin --profile web add https://github.com/RedCarl/dsh-balance-panel
```

也可以在 DSH 的「设置 → 插件」中粘贴这个 GitHub 地址；安装后刷新页面。

离线或锁定版本时，从 [GitHub Releases](https://github.com/RedCarl/dsh-balance-panel/releases) 下载 `*.tgz`，在安装框中粘贴本地绝对路径。

> 不需要 npmjs 账号；本插件通过 GitHub 仓库和 GitHub Release 分发。

## DeepSeek 峰谷提示

当前左侧平台是 DeepSeek（官方 API 或已登录的 DeepSeek 账号）时：

- 钱包图标左上角显示 **太阳（峰时）** 或 **月亮（谷时）** 小图标；
- 侧栏文字追加 `峰时` / `谷时`，例如 `DeepSeek · ¥330.75 · 峰时`；
- 面板该行的副标题显示 `峰时 · 标准价` 或 `谷时 · 5 折`，悬停可看完整规则。

规则（北京时间，周一至周五）：09:00–12:00、14:00–18:00 为峰时；其余时间、周末与中国法定节假日全天为谷时；谷时价格为峰时价格的 50%。插件内置 2026 年落在工作日的中国法定节假日；其他年份暂按工作日/时间估算。规则来源：[DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

## 跟随会话

侧栏入口和页面都跟随**当前会话**的模型：在会话里切换模型后立即重新查询；切换会话时也会重新检查；没有打开会话时回退到默认模型。页面只显示平台、余额/用量和关键变化；模型、密钥引用、接口地址、更新时间等细节放在行的悬停提示里。

## 静默刷新

每次会话完成一轮（Host 的 `agent/status` 变为 `idle`）后，插件仍在后台重新查询余额，但不再显示圆点或提醒条；侧栏金额/用量和页面数据会直接更新。需要立即刷新时，用页面右上角的刷新按钮。

## 数据与安全

余额全部在 Host 进程查询，浏览器只收到金额和状态，不会收到 API 密钥。查询走本机
`GET /plugins/balance-panel/state`（仅回环/受信 Host，`no-store`），前端每 15 秒检查一次，
Host 侧缓存 30 秒；页面隐藏时暂停。切换会话或模型时立即强制刷新。

## 配置

可选的 `cordis.patch.yml` 配置：

```yaml
- id: balance-panel
  config:
    cacheTtlMs: 30000
    timeoutMs: 12000
    autoRefreshAfterSession: true
    sources:
      - id: my-gateway
        label: 我的中转
        provider: opencode-go
        baseURL: https://gateway.example.com
        apiKeyEnv: MY_GATEWAY_KEY
        kind: newapi
      - id: custom-balance
        label: 自定义余额
        baseURL: https://api.example.com
        apiKeyEnv: EXAMPLE_KEY
        endpoint: /v1/account/balance
        amountPath: data.available
        currencyPath: data.currency
```

支持的内置 `kind`：`deepseek`、`opencode`、`moonshot`、`zhipu`、`openrouter`、`newapi`。
不填 `kind` 时按来源自动选择；`endpoint` + `amountPath` 可覆盖内置解析。

## 已知限制

- OpenAI / Anthropic / Gemini 等按量后付费服务没有公开的余额端点，只能通过中转网关查询。
- 账号余额依赖本机已登录的 DeepSeek 账号；未登录时不显示账号条目。
- 自定义 API 必须提供余额端点；没有公开余额接口的服务会显示查询失败原因。
