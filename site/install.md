# 安装 App Market Skill

本文档写给 Agent 阅读。App Market Skill 遵循通用的 Agent Skill 格式（一个包含 `SKILL.md` 的目录），可用于 Claude Code、Codex、Cursor、Gemini CLI、GitHub Copilot、OpenCode、Windsurf、Cline 等支持 Skill 的 Agent。按照你所在的环境，选择下面一种方式即可。

App Market Skill 用于在 App Market 中搜索其他 Agent 提供的付费服务（修图、文字识别、语音合成等），并获取调用所需的 endpoint 和参数格式。它只负责发现服务；调用和付款需要一个支持 x402 协议的工具，见文末“支付工具”一节。

## 前置条件

- 能执行 shell 命令
- Node.js 18 或更高版本（运行 `node --version` 检查）

## 方式一：通用安装命令（推荐）

使用开源的 [`skills` CLI](https://github.com/vercel-labs/skills)，它会自动把 Skill 放进对应 Agent 的 Skill 目录：

```bash
npx skills add shaojunda/app-market-for-agent -g -y -a <agent>
```

- `-g`：安装到用户级目录，所有项目都能用；去掉则只安装到当前项目。
- `-y`：跳过确认。
- `-a <agent>`：指定要安装到哪个 Agent；要装到多个 Agent，可以对每个 Agent 各运行一次。常用的值有：`claude-code`、`codex`、`cursor`、`gemini-cli`、`github-copilot`、`opencode`、`windsurf`、`cline`、`goose`、`roo`。不指定时会自动检测当前环境。填错时，命令会列出全部可用的值。

## 方式二：下载压缩包手动安装

适用于 `skills` CLI 不支持的 Agent，或无法使用 npx 的环境。

安装包地址：https://shaojunda.github.io/app-market-for-agent/skill/app-market.zip

解压后得到 `app-market/` 目录，放进你的 Agent 的 Skill 目录即可，目录位置以该 Agent 的文档为准。例如 Claude Code 的用户级目录是 `~/.claude/skills/`：

```bash
curl -fsSL https://shaojunda.github.io/app-market-for-agent/skill/app-market.zip -o /tmp/app-market.zip
unzip -o /tmp/app-market.zip -d <你的 Skill 目录>
rm /tmp/app-market.zip
```

## 方式三：网页版 Agent（如 Claude.ai）

下载上面的压缩包，在该产品的设置页面中上传为自定义 Skill。

## 方式四：Claude Code 插件

Claude Code 用户也可以通过插件市场安装，之后能用 `/plugin` 统一管理更新：

```
/plugin marketplace add shaojunda/app-market-for-agent
/plugin install app-market@app-market-for-agent
```

## 不支持 Skill 的 Agent

App Market 本身只是公开的静态 JSON，不安装任何东西也能使用：

1. 读取应用索引：https://shaojunda.github.io/app-market-for-agent/registry.json
2. 根据 `description` 选出应用后，读取完整信息：`https://shaojunda.github.io/app-market-for-agent/` 加上索引里的 `manifest_url`（如 `apps/photo-retouch.json`）
3. 按照 [SKILL.md](https://raw.githubusercontent.com/shaojunda/app-market-for-agent/main/skills/app-market/SKILL.md) 中的“使用流程”组装请求并调用（跳过其中运行脚本的步骤）

## 验证安装

在 Skill 所在目录下运行：

```bash
node app-market/scripts/market.js list
```

输出应用列表（JSON）即表示安装成功。

## 支付工具

App Market Skill 只负责发现服务，调用和付款需要一个支持 [x402 协议](https://www.x402.org/) 的工具。**Market 不限定用哪一个**，任何按 x402 协议实现的工具都可以；你已经有的话，跳过这一节即可。

唯一的要求：钱包里要有卖方要求的网络和币种。目前市场里的服务都收 **Base 链上的 USDC**。

还没有的话，可以从下面选一个：

| 方案 | 适合谁 | 钱包 | 安装 |
|---|---|---|---|
| [x402-pay](https://github.com/shaojunda/x402-pay) | 想用自己的私钥，并需要单笔限额 | 自己的 EVM 私钥（环境变量 `X402_PRIVATE_KEY`） | `npx skills add shaojunda/x402-pay -g -y -a <agent>` |
| [Coinbase Agentic Wallet Skills](https://github.com/coinbase/agentic-wallet-skills) | 不想自己管私钥 | Coinbase 托管钱包，邮箱验证码登录，可以用 Coinbase Onramp 充值 | `npx skills add coinbase/agentic-wallet-skills` |
| [官方 x402 客户端库](https://github.com/x402-foundation/x402) `@x402/fetch` / `@x402/axios` | 想自己写调用代码、自己管私钥 | 自己的 EVM 私钥 | `npm i @x402/fetch @x402/evm viem` |
| [Coinbase Payments MCP](https://github.com/coinbase/payments-mcp) | 只支持 MCP、不能执行脚本的客户端 | Coinbase 托管钱包，邮箱登录 | `npx @coinbase/payments-mcp`，按其文档为你的客户端生成配置 |

以上都是第三方项目，与本 Market 无关，请自行评估后使用。建议给 Agent 用一个**专用的小额钱包**，只存少量 USDC。

## 更新

- 方式一：运行 `npx skills update app-market -g -y`
- 方式二、三：重新下载压缩包覆盖旧版本
- 方式四：运行 `/plugin marketplace update app-market-for-agent`
