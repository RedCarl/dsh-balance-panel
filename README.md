# 余额与用量（Balance & Usage）

在左侧栏「自动化任务」同一区域增加一个**余额**入口：入口文字显示**平台 + 余额**（不显示模型名称），例如
`OpenCode · 99%`、`DeepSeek · ¥331.11`。它跟随当前会话选中的模型：切模型或切会话后立即重新查询；没有会话时回退到默认模型。点击后打开完整面板，按来源列出：

- **登录账号**：DeepSeek 账号的充值余额与赠金余额（未登录时不显示）。
- **OpenCode Go 套餐**：5 小时 / 本周 / 本月三档用量与重置时间。
- **DeepSeek / Moonshot / 智谱 / OpenRouter**：配置了对应环境变量或凭据后自动出现；未配置凭据的来源直接省略，不会显示 `missing credential` 行。
- **设置 → 模型里添加的自定义 API**：带 `baseURL` 的 OpenAI 兼容网关按 New API 的
  `/dashboard/billing/subscription` + `/dashboard/billing/usage` 计算余额。
- **插件配置里的 `sources`**：完全自定义端点、金额 JSON 路径和币种。
- **服务状态**：配置了 OpenCode / DeepSeek 来源时，页面底部显示 OpenCode Go 的当前状态与速度（首字延迟、tok/s），以及 DeepSeek 官方状态页中当前模型对应的 API 组件状态。
- **Token 统计**：扫描本地会话日志，按北京时间年 / 月 / 日 / 时聚合 provider 报告的 token 用量，并按 DeepSeek 账号、DeepSeek API、OpenCode Go 等来源堆叠展示；悬停柱段可看精确 Token 数。

## 安装

从私有 npm 源安装（推荐）：

```sh
dsh plugin --profile web add @local/dsh-balance-panel@latest
```

profile 需要认识 `@local` scope（`dsh-registry enable --profile web` 会写入
`@local:registry=https://npm.carljoy.cn/`）。也可以直接在
[npm.carljoy.cn](https://npm.carljoy.cn/) 的 Web 界面下载 tgz 离线安装。

## DeepSeek 峰谷提示

当前左侧平台是 DeepSeek（官方 API 或已登录的 DeepSeek 账号）时：

- 钱包图标左上角显示 **太阳（峰时）** 或 **月亮（谷时）** 小图标；
- 侧栏文字追加 `峰时` / `谷时`，例如 `DeepSeek · ¥330.75 · 峰时`；
- 面板该行的副标题显示 `峰时 · 标准价` 或 `谷时 · 5 折`，悬停可看完整规则。

规则（北京时间，周一至周五）：09:00–12:00、14:00–18:00 为峰时；其余时间、周末与中国法定节假日全天为谷时；谷时价格为峰时价格的 50%。插件内置 2026 年落在工作日的中国法定节假日；其他年份暂按工作日/时间估算。规则来源：[DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

## 跟随会话

侧栏入口和页面都跟随**当前会话**的模型：在会话里切换模型后立即重新查询；切换会话时也会重新检查；没有打开会话时回退到默认模型。页面只显示平台、余额/用量和关键变化；模型、密钥引用、接口地址、更新时间等细节放在行的悬停提示里。

## Token 统计

页面底部的「Token 统计」不依赖 API key，读取本机已保存的会话日志：

- 按北京时间聚合 **年 / 月 / 日 / 时**，点击页签切换；
- 柱状图按 provider / 账号接入方式堆叠：DeepSeek 账号登录、DeepSeek API、OpenCode Go 等；图例只保留颜色和名称，不再堆叠百分比和汇总行；
- 标题下只显示所选区间和合计，保持紧凑；
- 鼠标移入柱段立即显示浮层，无需等待浏览器原生 title 延迟；浮层显示该来源在该时段的精确总量、输入、输出和缓存读取；悬停图例可看该来源的总量和请求数；
- 只统计数据，不读取或上传任何消息内容；
- 首次统计需要遍历本地会话，可能耗时几秒；结果缓存 10 分钟。

Token 用量取 provider 在 `assistant/message` 中报告的值，包含缓存读取；fork 继承的事件不会重复计数。只统计本机已持久化的会话。分类来自会话请求头里的 provider 路由：`deepseek-official` 显示为 DeepSeek 账号，`deepseek` 显示为 DeepSeek API，`opencode-go` 显示为 OpenCode Go；同一 provider 下配置多个 API key 时，日志没有单独的账号标识，无法再拆分成多个账号。

## 服务状态

页面底部的「服务状态」只在对应来源存在时出现：

- **OpenCode Go**：读取 [status.opencode.ai](https://status.opencode.ai/) 的公开 JSON API，显示 Go 的当前状态，以及当前模型最近 5 分钟的首字延迟和输出速度；悬停可看具体模型、原因和更新时间。
- **DeepSeek**：读取 [status.deepseek.com](https://status.deepseek.com/) 官方状态页，按当前模型匹配 V4.1 Flash / V4 Pro API 组件，显示组件状态；悬停可看整体状态、事件和更新时间。

状态结果缓存 60 秒；状态页不可达时显示「未知」，不影响余额查询。

## 自动更新

页面标题旁的版本号可以点击检查更新。检测读取私有源的 packument
（`https://npm.carljoy.cn/@local%2fdsh-balance-panel`，取 `dist-tags.latest`），
结果缓存 10 分钟；点击版本号会强制检查。发现新版本时出现「更新 vX.Y.Z」按钮：

- **源码安装（link:/git）**：工作区干净时执行 `git pull --ff-only`，成功后自动重载插件。
- **打包安装**：交给 DSH 插件管理器安装 registry 上的同一版本；HMR 拒绝覆盖时回退到该版本的 registry tarball。
- 升级失败（例如版本与当前 DSH 不兼容）会在页面上显示插件管理器返回的原因。

更新只访问私有源，不读取或上传任何密钥。

## 更新失败时

旧版本（例如 1.3.0）的页内更新在安装失败时可能只显示 `[object Object]`；
1.4.2 起会显示插件管理器返回的错误码和诊断。若目前卡在旧版本，可直接在目标机器执行：

```sh
dsh plugin --profile web add @local/dsh-balance-panel@1.4.2
```

如果 profile 启用了 pnpm 的 `minimumReleaseAge`，或版本解析不可用，改用 tarball 直装：

```sh
dsh plugin --profile web add https://npm.carljoy.cn/@local/dsh-balance-panel/-/dsh-balance-panel-1.4.2.tgz
```

也可以在 `https://npm.carljoy.cn/` 下载 tgz 后粘贴本地绝对路径安装。
安装后刷新页面即可。

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
- 未配置 API key 的来源会直接省略；所有来源都未配置时显示「未发现余额来源」。
- 自定义 API 必须提供余额端点；没有公开余额接口的服务会显示查询失败原因。
