#!/usr/bin/env node
// App Market 查询脚本：只负责发现应用，不发起调用、不涉及支付。
//
// 用法：
//   node market.js list                     列出所有应用摘要
//   node market.js search <关键词...>        按关键词搜索应用
//   node market.js get <app-id> [action-id]  读取完整 manifest（或其中一个 action）
//
// Registry 地址通过环境变量 APP_MARKET_REGISTRY 指定，可以是 URL 或本地文件路径。

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_REGISTRY = "https://shaojunda.github.io/app-market-for-agent/registry.json";
const REGISTRY = process.env.APP_MARKET_REGISTRY || DEFAULT_REGISTRY;

function isUrl(s) {
  return /^https?:\/\//i.test(s);
}

// 把 manifest_url 解析成可读取的地址：绝对 URL 原样使用，相对路径相对于 registry 所在位置
function resolveRef(ref) {
  if (isUrl(ref)) return ref;
  if (isUrl(REGISTRY)) return new URL(ref, REGISTRY).toString();
  return path.resolve(path.dirname(path.resolve(REGISTRY)), ref);
}

async function loadJson(location) {
  let text;
  if (isUrl(location)) {
    let res;
    try {
      res = await fetch(location, { signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new Error(`无法访问 ${location}：${err.cause?.message || err.message}`);
    }
    if (!res.ok) throw new Error(`请求 ${location} 失败：HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = await fs.readFile(location, "utf8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${location} 不是合法的 JSON`);
  }
}

// 本脚本支持的 registry 格式版本；registry 格式有不兼容的改动时递增
const SUPPORTED_SCHEMA_VERSION = 1;
const UPDATE_COMMAND = "npx skills update -g -y";

// 需要告诉用户的提示，会附加在输出的 update_notice 字段里
let updateNotice;

function checkSchemaVersion(registry) {
  const version = Number(registry.schema_version);
  if (!Number.isInteger(version) || version <= SUPPORTED_SCHEMA_VERSION) return;
  updateNotice =
    `App Market 的数据格式已升级到版本 ${version}，当前 Skill 只支持到版本 ${SUPPORTED_SCHEMA_VERSION}，结果可能不完整或出错。` +
    `请更新 app-market Skill：运行 \`${UPDATE_COMMAND}\`，其他安装方式见 https://shaojunda.github.io/app-market-for-agent/install.md`;
  process.stderr.write(`提示：${updateNotice}\n`);
}

async function loadRegistry() {
  const registry = await loadJson(REGISTRY);
  checkSchemaVersion(registry);
  if (!Array.isArray(registry.apps)) throw new Error("registry 格式错误：缺少 apps 数组");
  return registry;
}

function summarize(app) {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    provider: app.provider,
    payment: app.payment,
    actions: (app.actions || []).map((a) => ({ id: a.id, description: a.description, price: a.price })),
  };
}

// 按关键词命中数打分：名称和标签权重更高，描述和 action 描述次之
function score(app, keywords) {
  const name = (app.name || "").toLowerCase();
  const tags = (app.tags || []).map((t) => t.toLowerCase());
  const text = [app.description, ...(app.actions || []).map((a) => `${a.id} ${a.description}`)]
    .join(" ")
    .toLowerCase();
  let total = 0;
  for (const kw of keywords) {
    if (name.includes(kw)) total += 3;
    if (tags.some((t) => t.includes(kw) || kw.includes(t))) total += 2;
    if (text.includes(kw)) total += 1;
  }
  return total;
}

function print(data) {
  const output = updateNotice ? { update_notice: updateNotice, ...data } : data;
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

async function cmdList() {
  const registry = await loadRegistry();
  print({ updated_at: registry.updated_at, count: registry.apps.length, apps: registry.apps.map(summarize) });
}

async function cmdSearch(args) {
  const keywords = args.map((k) => k.toLowerCase().trim()).filter(Boolean);
  if (keywords.length === 0) throw new Error("请提供至少一个关键词");
  const registry = await loadRegistry();
  const results = registry.apps
    .map((app) => ({ app, score: score(app, keywords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => summarize(r.app));
  print({ query: keywords, count: results.length, apps: results });
}

async function cmdGet([appId, actionId]) {
  if (!appId) throw new Error("请提供 app-id");
  const registry = await loadRegistry();
  const entry = registry.apps.find((a) => a.id === appId);
  if (!entry) throw new Error(`没有找到应用 ${appId}，请先用 list 或 search 确认 id`);
  if (!entry.manifest_url) throw new Error(`应用 ${appId} 缺少 manifest_url`);

  const manifest = await loadJson(resolveRef(entry.manifest_url));
  if (manifest.id !== appId) throw new Error(`manifest 的 id（${manifest.id}）与 registry 不一致`);

  if (!actionId) return print(manifest);

  const action = (manifest.actions || []).find((a) => a.id === actionId);
  if (!action) {
    const ids = (manifest.actions || []).map((a) => a.id).join(", ");
    throw new Error(`应用 ${appId} 没有 action ${actionId}，可用的有：${ids}`);
  }
  const { actions, ...rest } = manifest;
  print({ ...rest, action });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "list":
      return cmdList();
    case "search":
      return cmdSearch(args);
    case "get":
      return cmdGet(args);
    default:
      throw new Error("用法：market.js list | search <关键词...> | get <app-id> [action-id]");
  }
}

main().catch((err) => {
  process.stderr.write(`错误：${err.message}\n`);
  process.exit(1);
});
