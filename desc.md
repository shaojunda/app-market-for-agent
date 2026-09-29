# App Market for Agent

## Description

App Market for Agent 是一个平台，让 Agent 可以上架并出售自己的应用与服务。Agent 可以通过这个平台搜索并购买其他 Agent 的应用与服务。

## Notes
- 应用方使用 x402 支付协议

## 已确定的决策

| # | 问题 | 决策 |
|---|---|---|
| 1 | Market 的角色 | **纯目录**：Market 只负责发现，买方通过 x402 直接付款给商户，Market 不经手资金、不代理调用 |
| 2 | 服务形态 | 按次调用的 API 服务，典型例子：修图应用 |
| 3 | 信任与纠纷 | 暂不处理 |
| 4 | 商户准入 | 中心化维护应用列表（人工审核收录） |
| 5 | 搜索方式 | Market 以 Skill 的形式提供给 Agent |
| 6 | 调用与支付 | 不由 Market 负责，交给买方自选的任意 x402 工具；Market 不绑定钱包或 x402 实现，只在安装说明里推荐可选方案 |
| 7 | manifest 格式 | 统一使用 JSON，格式规范见 `schema/manifest.schema.json` |
| 8 | 托管与分发 | 放在 GitHub 仓库 `shaojunda/app-market-for-agent`，卖方通过 PR 提交；构建产物部署到 GitHub Pages；Skill 以 zip 包和 Claude Code 插件两种方式分发 |

## 草案设计

### 应用清单（Registry）

中心化维护一份应用清单，每个应用对应一份 manifest（格式见下文“卖方接入”），由人工审核后收录。

参考 Skill 的按需加载，发布产物分两层：

```
registry.json            # 索引：只放用于发现和选择的摘要信息
apps/<id>.json           # 详情：完整 manifest（endpoint、schema、示例），选定后才读取
```

- Agent 先读 `registry.json`，根据 `description` 和 action 摘要选出要用的应用。
- 选定后再读 `apps/<id>.json`，把完整信息交给 x402 Skill 调用。
- 这样即使应用变多，索引也不会占用太多上下文。
- 两层文件都由构建脚本（`npm run build`）从卖方提交的 `registry/*.json` 自动生成，不需要手工维护。

`registry.json` 示例：

```json
{
  "schema_version": "1",
  "updated_at": "2026-09-29T08:00:00Z",
  "apps": [
    {
      "id": "photo-retouch",
      "name": "智能人像修图",
      "description": "对人像照片进行美颜、去瑕疵、调色，以及去除背景。当用户需要美化人像照片或制作透明背景人像图时使用。",
      "version": "1.0.0",
      "tags": ["image", "photo", "retouch", "background-removal"],
      "provider": "Example Studio",
      "payment": { "network": "eip155:8453", "asset": "USDC" },
      "actions": [
        { "id": "retouch", "description": "人像美颜和调色，返回处理后的图片", "price": "0.05" },
        { "id": "remove-background", "description": "去除人像背景，返回透明背景 PNG", "price": "0.02" }
      ],
      "manifest_url": "apps/photo-retouch.json"
    },
    {
      "id": "doc-ocr",
      "name": "文档文字识别",
      "description": "识别图片或 PDF 中的文字，支持中英文和表格。当用户需要从扫描件、截图或照片中提取文字时使用。",
      "version": "2.1.0",
      "tags": ["ocr", "document", "pdf", "image"],
      "provider": "Paper Labs",
      "payment": { "network": "eip155:8453", "asset": "USDC" },
      "actions": [
        { "id": "extract-text", "description": "提取纯文本", "price": "0.01" },
        { "id": "extract-table", "description": "识别表格，返回结构化 JSON", "price": "0.03" }
      ],
      "manifest_url": "apps/doc-ocr.json"
    },
    {
      "id": "voice-tts",
      "name": "多语种语音合成",
      "description": "把文字转换成自然的语音，支持 20 种语言和多种音色。当用户需要朗读文本或生成配音音频时使用。",
      "version": "1.2.0",
      "tags": ["audio", "tts", "voice"],
      "provider": "Sonic Works",
      "payment": { "network": "eip155:8453", "asset": "USDC" },
      "actions": [
        { "id": "synthesize", "description": "合成语音，返回 MP3 地址；每次最多 5000 字", "price": "0.02" }
      ],
      "manifest_url": "apps/voice-tts.json"
    }
  ]
}
```

索引字段说明：
- `schema_version`：registry 格式的版本，用于以后兼容升级。
  - 只新增可选字段时**不需要**升级版本，旧版 Skill 会忽略不认识的字段。
  - 删除或重命名字段、改变字段含义等不兼容改动时，同时递增 `scripts/build.js` 中生成的 `schema_version` 和 `skills/app-market/scripts/market.js` 中的 `SUPPORTED_SCHEMA_VERSION`。
  - 旧版 Skill 读到更高的版本时，会在输出中附加 `update_notice`，由 Agent 提示用户更新 Skill。
- `updated_at`：生成时间，Skill 可以据此判断本地缓存是否过期。
- `apps[].actions[]`：只保留 `id`、`description`、`price`，足够 Agent 做选择。
- `apps[].manifest_url`：完整 manifest 的地址，可以是绝对 URL，也可以是相对于 `registry.json` 的路径（如 `apps/photo-retouch.json`）。内容就是卖方提交的 manifest（去掉 `$schema` 字段），endpoint、schema、示例都在里面。

### 接入方式：两个独立的 Skill

发现和支付分开，由两个互不依赖的 Skill 负责：

```
app-market Skill（发现）            x402 Skill（调用 + 支付）
  搜索清单 → 选出应用 → 读 manifest ──→ 按 endpoint + schema 发请求
                                        402 → 签名 → 重试 → 拿到结果
```

**`app-market` Skill：只负责发现，不接触钱包**
- `SKILL.md`：什么时候使用；如何拉取 `registry.json`；如何根据 `name / description` 挑选应用；选定后读取完整 manifest，交给 x402 Skill 调用
- `scripts/search.js`（可选）：按关键词过滤清单。清单规模小时，可以直接读全量由模型挑选
- Market 端只需托管静态的 `registry.json`，没有需要运行的服务

**x402 工具：通用的 x402 调用与支付能力，和 Market 无关，由买方自选**（x402 Skill、MCP Server、内置 x402 的钱包都可以，下面以 Skill 为例）
- 输入：endpoint、method、请求体（可以是本地文件路径，由脚本转成 base64）
- 流程：发请求 → 收到 402（支付要求在 `PAYMENT-REQUIRED` 响应头中）→ 按支付要求签名 → 带上 `PAYMENT-SIGNATURE` 请求头重试 → 返回结果（结算信息在 `PAYMENT-RESPONSE` 响应头中）
- 配置：钱包私钥、网络、单笔上限、每日上限
- 可以复用已有的实现，也能单独调用 Market 以外的任何 x402 服务

**两个 Skill 之间的约定就是 manifest**：`endpoint`、`input_schema` 和 `output_schema` 要足够让 x402 Skill 构造出正确的请求。

**安全提示**：Skill 里的限额只是软约束，建议给 Agent 配一个专用的小额钱包。

## 卖方接入

### 前置条件

卖方 Agent 上架前，自己的服务需要满足：

1. **服务已接入 x402**：未付款的请求返回 `402 Payment Required` 以及支付要求；带合法付款签名的请求正常返回结果。建议使用 x402 v2（请求头 `PAYMENT-SIGNATURE`，v1 为 `X-PAYMENT`）。可以直接使用 x402 官方的服务端中间件（Express、Hono、Next.js 等）。
2. **有收款钱包**：用于接收 USDC，地址由服务在 402 响应的 `payTo` 中返回，不需要登记到 manifest，可以随时更换。
3. **有公网 HTTPS endpoint**：服务稳定可访问。
4. **调用是无状态的单次请求**：一次付款对应一次请求，并在这次响应里返回完整结果。
5. **文件用 URL 传递**：输入建议同时支持 URL 和 base64；输出建议返回带有效期的 URL，不要直接返回大段 base64。

### 需要提供的信息

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 全局唯一标识，小写字母、数字和 `-`，必须与文件名一致 |
| `name` | ✅ | 应用名称 |
| `description` | ✅ | **最重要的字段**。Agent 靠它判断要不要用这个应用。写清楚“能做什么”和“什么时候该用” |
| `version` | ✅ | manifest 版本号，每次修改都要递增 |
| `tags` | | 分类标签，辅助搜索 |
| `provider` | ✅ | 卖方信息：名称、联系方式、网站 |
| `payment.network` / `payment.asset` | ✅ | 收款网络和币种，例如 `eip155:8453`（Base 主网）/ `USDC`。网络使用 x402 v2 的 CAIP-2 格式，必须和 402 响应一致。买方据此判断自己的钱包能否付款 |
| `actions` | ✅ | 应用提供的能力列表。一个应用可以有多个 action，例如“美颜”和“抠图” |
| `actions[].id` / `description` | ✅ | action 的标识和说明 |
| `actions[].endpoint` | ✅ | `url`、`method`、`content_type` |
| `actions[].price` | ✅ | 单次价格。仅用于展示，实际扣费以 402 响应为准，两者必须一致 |
| `actions[].input_schema` | ✅ | 请求体的 JSON Schema，每个字段都要写 `description` |
| `actions[].output_schema` | ✅ | 响应体的 JSON Schema |
| `actions[].example` | ✅ | 一组真实可用的请求和响应示例，审核时会实际调用 |
| `actions[].timeout_seconds` | | 预计最长处理时间，方便买方设置超时 |

### 模版

manifest 使用 JSON 格式。完整的格式规范见 [`schema/manifest.schema.json`](schema/manifest.schema.json)，其中每个字段都带有说明。在文件开头加上 `"$schema"`，编辑器就能自动校验和补全。

```json
{
  "$schema": "../schema/manifest.schema.json",
  "id": "your-app-id",
  "name": "应用名称",
  "description": "一句话说明应用能做什么。当用户需要……时使用。",
  "version": "1.0.0",
  "tags": ["tag1", "tag2"],
  "provider": {
    "name": "卖方名称",
    "contact": "contact@example.com",
    "website": "https://example.com"
  },
  "payment": {
    "network": "eip155:8453",
    "asset": "USDC"
  },
  "actions": [
    {
      "id": "action-id",
      "description": "这个 action 做什么",
      "endpoint": {
        "url": "https://api.example.com/v1/action",
        "method": "POST",
        "content_type": "application/json"
      },
      "price": "0.01",
      "timeout_seconds": 30,
      "input_schema": {
        "type": "object",
        "required": ["field1"],
        "properties": {
          "field1": { "type": "string", "description": "字段说明" }
        }
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "result": { "type": "string", "description": "字段说明" }
        }
      },
      "example": {
        "request": { "field1": "示例值" },
        "response": { "result": "示例结果" }
      }
    }
  ]
}
```

格式要点：
- `price` 必须是**字符串**（如 `"0.05"`），不能写成数字，以免浮点精度问题。
- `tags`、`id`、`actions[].id` 只能用小写字母、数字和 `-`。
- `payment.network` 使用 CAIP-2 格式：Base 主网写 `eip155:8453`，Base Sepolia 测试网写 `eip155:84532`。

### 示例

完整示例见 `registry/` 目录：
- [`registry/chinese-naming-demo.json`](registry/chinese-naming-demo.json)：中文起名，Base Sepolia 测试网上的真实服务，服务代码见 [x402-naming-demo](https://github.com/shaojunda/x402-naming-demo)

上文 `registry.json` 示例中的修图、文字识别、语音合成是为说明格式虚构的应用，并未上架。

### 提交与审核

**提交方式**：向 [shaojunda/app-market-for-agent](https://github.com/shaojunda/app-market-for-agent) 提交 PR，新增 `registry/<id>.json`。一个上架 PR 只能修改 `registry/` 下的文件。提交前可以在本地自查：

```bash
npm run check                                       # 格式校验
npm run check:endpoints -- registry/<id>.json       # 线上 402 检查（不会付款）
```

**自动检查（CI）：**

格式校验（`npm run check`）：
- [ ] 是合法的 JSON，并且符合 `schema/manifest.schema.json`
- [ ] `id` 和文件名一致（因此不会与已有应用重复）
- [ ] 同一应用内 action id 不重复
- [ ] `input_schema` / `output_schema` 本身是合法的 JSON Schema
- [ ] `example.request` 符合 `input_schema`，`example.response` 符合 `output_schema`

上架检查（`scripts/check-pr.js`，取自目标分支运行，PR 无法修改它）：
- [ ] PR 只修改了 `registry/*.json`
- [ ] 修改已有应用时，`version` 比原来的大
- [ ] 不带付款请求每个新增或修改的 endpoint，返回 402
- [ ] 402 里有 `payment.network` 上的 `exact` 付款方式，币种是该网络的官方 USDC，金额等于 `price`

**人工审核：**
- [ ] 按 `example.request` 实际付款调用一次，返回结果符合 `output_schema`
- [ ] `description` 能让 Agent 准确判断什么时候该使用

**更新**：修改 manifest 后递增 `version` 并重新提交；调整价格时必须同时更新 manifest 和服务端。

**发布**：合并后运行 `npm run build`，生成 `dist/registry.json` 和 `dist/apps/<id>.json`，再把 `dist/` 部署到静态托管。

## 待讨论
- 上架时是否自动校验 endpoint 确实返回合法的 402
- 图片等大文件的传递方式（URL / base64 / 上传到临时存储）
- 平台的收入模式（纯目录模式下交易不经过平台，无法抽成）
