#!/usr/bin/env node
// PR 检查：限制上架 PR 的改动范围，检查版本号递增，并对新增或修改的应用做线上 402 检查。
// CI 会用目标分支上的这份脚本运行，PR 无法通过修改它来绕过检查。
//
// 用法：node scripts/check-pr.js <base-sha>
//   在 PR 代码的根目录下运行；需要完整的 git 历史，以便与 base 比较。

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { checkManifest } = require("./check-endpoints");

const REGISTRY = /^registry\/[^/]+\.json$/;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function changedFiles(base) {
  return git("diff", "--name-status", "--no-renames", base, "HEAD")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const base = process.argv[2];
  if (!base) throw new Error("用法：node scripts/check-pr.js <base-sha>");

  const files = changedFiles(base);
  const registryChanges = files.filter((f) => REGISTRY.test(f.file));
  const otherChanges = files.filter((f) => !REGISTRY.test(f.file));
  const errors = [];

  if (registryChanges.length === 0) {
    console.log("本 PR 没有修改 registry/，跳过上架检查。");
    return;
  }

  // 1. 改动范围：上架 PR 只能修改 registry/ 下的 manifest
  if (otherChanges.length) {
    errors.push(
      `上架 PR 只能修改 registry/*.json，但还修改了：${otherChanges.map((f) => f.file).join(", ")}。请把其他改动拆到单独的 PR。`,
    );
  }

  // 2. 版本号：修改已有应用时 version 必须递增
  const toCheck = [];
  for (const { status, file } of registryChanges) {
    if (status === "D") {
      console.log(`- ${file}：下架`);
      continue;
    }
    const manifest = readJson(fs.readFileSync(file, "utf8"));
    if (!manifest) continue; // 格式错误由 npm run check 报告
    if (status === "M") {
      const old = readJson(git("show", `${base}:${file}`));
      if (old && typeof manifest.version === "string" && compareVersions(manifest.version, old.version) <= 0) {
        errors.push(`${file}：修改已有应用时必须递增 version（当前 ${old.version}，PR 中为 ${manifest.version}）`);
      }
      console.log(`- ${file}：更新 ${old?.version} → ${manifest.version}`);
    } else {
      console.log(`- ${file}：新增`);
    }
    toCheck.push({ file, manifest });
  }

  // 3. 线上检查：endpoint 返回的 402 与 manifest 一致
  for (const { file, manifest } of toCheck) {
    if (!Array.isArray(manifest.actions) || !manifest.payment) continue;
    for (const { action, errors: actionErrors } of await checkManifest(manifest)) {
      if (actionErrors.length) {
        errors.push(...actionErrors.map((e) => `${path.basename(file)} → ${action}：${e}`));
      } else {
        console.log(`✓ ${path.basename(file)} → ${action}：402 与 manifest 一致`);
      }
    }
  }

  if (errors.length) {
    console.error("\n上架检查未通过：");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\n上架检查通过");
}

main().catch((err) => {
  console.error(`错误：${err.message}`);
  process.exit(1);
});
