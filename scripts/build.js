#!/usr/bin/env node
// 校验卖方提交的 manifest（registry/*.json），并生成部署到 GitHub Pages 的站点：
//   dist/registry.json                索引，只含发现和选择所需的摘要
//   dist/apps/<id>.json               完整 manifest（去掉仅供编辑器使用的 $schema 字段）
//   dist/schema/manifest.schema.json  manifest 格式规范
//   dist/skill/app-market.zip         Market Skill 安装包
//   dist/*                            site/ 下的静态文件（安装说明等）
//
// 用法：
//   node scripts/build.js           校验并生成
//   node scripts/build.js --check   只校验，不生成（用于 PR 检查）

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Ajv = require("ajv");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "registry");
const OUT_DIR = path.join(ROOT, "dist");
const SCHEMA = path.join(ROOT, "schema", "manifest.schema.json");
const SITE_DIR = path.join(ROOT, "site");
const SKILLS_DIR = path.join(ROOT, "skills");

const checkOnly = process.argv.includes("--check");

const ajv = new Ajv({ allErrors: true, strict: false });
// multipart 文件字段用 format: "binary" 标记；它不对字符串内容做限制
ajv.addFormat("binary", true);
const validateManifest = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, "utf8")));

function formatErrors(errors) {
  return errors.map((e) => `${e.instancePath || "(根)"} ${e.message}`);
}

// 用 manifest 里声明的 schema 校验示例数据，确保示例和声明一致
function checkExample(label, schema, data) {
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return [`${label} 的 schema 不是合法的 JSON Schema：${err.message}`];
  }
  if (validate(data)) return [];
  return formatErrors(validate.errors).map((m) => `${label} 不符合 schema：${m}`);
}

function checkFile(file) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
  } catch (err) {
    return { errors: [`不是合法的 JSON：${err.message}`] };
  }

  if (!validateManifest(manifest)) {
    return { errors: formatErrors(validateManifest.errors) };
  }

  const expectedId = path.basename(file, ".json");
  if (manifest.id !== expectedId) errors.push(`id（${manifest.id}）必须与文件名（${expectedId}）一致`);

  const seen = new Set();
  for (const action of manifest.actions) {
    if (seen.has(action.id)) errors.push(`action id 重复：${action.id}`);
    seen.add(action.id);
    const prefix = `actions[${action.id}]`;
    errors.push(...checkExample(`${prefix}.example.request`, action.input_schema, action.example.request));
    errors.push(...checkExample(`${prefix}.example.response`, action.output_schema, action.example.response));
  }

  errors.push(...checkDependencies(manifest.actions));
  if (!manifest.actions.some((a) => Number(a.price) > 0)) {
    errors.push("至少要有一个收费的 action（price 大于 0）");
  }

  return { manifest, errors };
}

// depends_on 只能引用同一应用内的其他 action，且不能形成循环
function checkDependencies(actions) {
  const errors = [];
  const byId = new Map(actions.map((a) => [a.id, a]));
  for (const action of actions) {
    for (const dep of action.depends_on || []) {
      if (dep === action.id) errors.push(`actions[${action.id}].depends_on 不能依赖自己`);
      else if (!byId.has(dep)) errors.push(`actions[${action.id}].depends_on 引用了不存在的 action：${dep}`);
    }
  }
  const state = new Map(); // 1 = 访问中，2 = 已完成
  const visit = (id, chain) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      errors.push(`depends_on 存在循环：${[...chain, id].join(" → ")}`);
      return;
    }
    state.set(id, 1);
    for (const dep of byId.get(id)?.depends_on || []) if (byId.has(dep) && dep !== id) visit(dep, [...chain, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return errors;
}

function summarize(m) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    version: m.version,
    tags: m.tags || [],
    provider: m.provider.name,
    payment: { network: m.payment.network, asset: m.payment.asset },
    actions: m.actions.map((a) => ({ id: a.id, description: a.description, price: a.price })),
    manifest_url: `apps/${m.id}.json`,
  };
}

function main() {
  // 所有应用都下架后 registry/ 为空目录，git 不会保留它
  const files = fs.existsSync(SRC_DIR) ? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  const manifests = [];
  let failed = 0;

  for (const file of files) {
    const { manifest, errors } = checkFile(file);
    if (errors.length) {
      failed++;
      console.error(`✗ registry/${file}`);
      for (const e of errors) console.error(`    ${e}`);
    } else {
      console.log(`✓ registry/${file}`);
      manifests.push({ file, manifest });
    }
  }

  if (failed) {
    console.error(`\n${failed} 个 manifest 校验失败`);
    process.exit(1);
  }
  console.log(`\n${manifests.length} 个 manifest 全部通过`);
  if (checkOnly) return;

  // 每次从空目录开始生成，避免已下架的应用残留
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const appsDir = path.join(OUT_DIR, "apps");
  fs.mkdirSync(appsDir, { recursive: true });

  for (const { file, manifest } of manifests) {
    const { $schema, ...published } = manifest;
    fs.writeFileSync(path.join(appsDir, file), JSON.stringify(published, null, 2) + "\n");
  }

  const registry = {
    schema_version: "1",
    updated_at: new Date().toISOString(),
    apps: manifests.map(({ manifest }) => summarize(manifest)),
  };
  fs.writeFileSync(path.join(OUT_DIR, "registry.json"), JSON.stringify(registry, null, 2) + "\n");

  fs.cpSync(SITE_DIR, OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "schema"));
  fs.copyFileSync(SCHEMA, path.join(OUT_DIR, "schema", "manifest.schema.json"));

  // 打包时以 skills/ 为根目录，解压后得到 app-market/SKILL.md
  fs.mkdirSync(path.join(OUT_DIR, "skill"));
  execFileSync("zip", ["-qr", path.join(OUT_DIR, "skill", "app-market.zip"), "app-market", "-x", "*.DS_Store"], {
    cwd: SKILLS_DIR,
  });

  console.log("已生成 dist/");
}

main();
