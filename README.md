# App Market for Agent

一个供 Agent 使用的应用市场：卖方 Agent 上架按次付费的服务，买方 Agent 搜索并通过 [x402](https://www.x402.org/) 协议直接付款调用。

Market 只是一个**目录**：它负责让服务被发现，不经手资金，也不代理调用。买方直接付款给卖方。

```
买方 Agent
  ├─ app-market Skill   搜索目录 → 选出应用 → 读取 endpoint 和参数格式
  └─ 任意 x402 工具     调用卖方服务 → 收到 402 → 签名付款 → 拿到结果（Market 不限定实现）
```

Market 部署在 GitHub Pages 上：https://shaojunda.github.io/app-market-for-agent/

| 地址 | 内容 |
|---|---|
| [`/registry.json`](https://shaojunda.github.io/app-market-for-agent/registry.json) | 应用索引，只包含用于搜索和选择的摘要信息 |
| `/apps/<id>.json` | 单个应用的完整 manifest |
| [`/schema/manifest.schema.json`](https://shaojunda.github.io/app-market-for-agent/schema/manifest.schema.json) | manifest 格式规范 |
| [`/skill/app-market.zip`](https://shaojunda.github.io/app-market-for-agent/skill/app-market.zip) | Market Skill 安装包 |
| [`/install.md`](https://shaojunda.github.io/app-market-for-agent/install.md) | 给 Agent 阅读的安装说明 |

## 买方：安装 Market Skill

Market Skill 使用通用的 Agent Skill 格式，支持 Claude Code、Codex、Cursor、Gemini CLI、GitHub Copilot、OpenCode 等 Agent。

最简单的方式是让你的 Agent 自己安装：

> 读一下 https://shaojunda.github.io/app-market-for-agent/install.md ，把 App Market 装上

也可以手动运行通用安装命令（`<agent>` 换成 `claude-code`、`codex`、`cursor` 等）：

```bash
npx skills add shaojunda/app-market-for-agent -g -y -a <agent>
```

其他安装方式（压缩包、网页版 Agent、Claude Code 插件），以及不支持 Skill 的 Agent 如何直接使用，见 [install.md](site/install.md)。

运行 Skill 需要 Node.js 18 或更高版本。调用服务和付款还需要一个支持 x402 协议的工具，Market 不限定用哪一个，可选方案见 [install.md 的“支付工具”一节](site/install.md#支付工具)。

安装后，Agent 遇到自己做不了的任务（例如修图），会搜索 Market，并在付款前告诉你服务名称和价格，等你确认。

## 卖方：上架应用

1. 让你的服务支持 x402：未付款的请求返回 `402 Payment Required`，付款后返回结果。
2. 按照 [manifest 格式规范](schema/manifest.schema.json) 编写 `registry/<id>.json`。可以参考 [`registry/photo-retouch.json`](registry/photo-retouch.json)。
3. 在本地运行 `npm install && npm run check`，确认校验通过。
4. 向本仓库提交 PR。CI 会自动校验，人工审核会实际调用一次你的服务。

字段说明、前置条件和审核清单见 [desc.md 的“卖方接入”一节](desc.md#卖方接入)。

## 目录结构

```
registry/          卖方提交的 manifest，每个应用一个 JSON 文件
schema/            manifest 的 JSON Schema
skills/app-market/ 买方使用的 Market Skill
site/              发布到 Pages 的静态文件（安装说明）
scripts/build.js   校验 manifest，生成 dist/
.claude-plugin/    Claude Code 插件与插件市场配置
desc.md            需求与设计文档
```

## 开发

```bash
npm install
npm run check    # 只校验 registry/ 下的 manifest
npm run build    # 校验并生成 dist/
```

用本地构建结果测试 Skill：

```bash
APP_MARKET_REGISTRY=dist/registry.json node skills/app-market/scripts/market.js search 修图
```

推送到 `main` 后，GitHub Actions 会自动构建并部署到 Pages；PR 只运行校验。
