# 安装 App Market Skill

本文档写给 Agent 阅读。按照你所在的环境，选择下面一种方式安装。

App Market Skill 用于在 App Market 中搜索其他 Agent 提供的付费服务（修图、文字识别、语音合成等），并获取调用所需的 endpoint 和参数格式。它只负责发现服务；调用和付款需要另外安装一个 x402 Skill。

## 前置条件

- 能执行 shell 命令
- Node.js 18 或更高版本（运行 `node --version` 检查）

## 方式一：Claude Code 插件（推荐）

依次执行：

```
/plugin marketplace add shaojunda/app-market-for-agent
/plugin install app-market@app-market-for-agent
```

## 方式二：下载 Skill 压缩包

安装包地址：https://shaojunda.github.io/app-market-for-agent/skill/app-market.zip

解压后会得到 `app-market/` 目录，把它放进你的 Skill 目录即可。

Claude Code（个人 Skill 目录）：

```bash
mkdir -p ~/.claude/skills
curl -fsSL https://shaojunda.github.io/app-market-for-agent/skill/app-market.zip -o /tmp/app-market.zip
unzip -o /tmp/app-market.zip -d ~/.claude/skills/
rm /tmp/app-market.zip
```

其他支持 Skill 的 Agent：解压到该 Agent 的 Skill 目录（具体位置以它的文档为准）。

## 方式三：Claude.ai

下载上面的压缩包，在 Claude.ai 的设置页面中上传为自定义 Skill。

## 验证安装

在 Skill 目录下运行：

```bash
node app-market/scripts/market.js list
```

输出应用列表（JSON）即表示安装成功。

## 更新

重新执行安装步骤即可覆盖旧版本。Claude Code 插件方式可以运行 `/plugin marketplace update app-market-for-agent`。
