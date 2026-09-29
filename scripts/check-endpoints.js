#!/usr/bin/env node
// 线上检查：不带付款请求 manifest 中的每个 endpoint，确认返回 402，
// 并且支付要求中的网络、币种、金额与 manifest 一致。不会产生任何付款。
//
// 用法：node scripts/check-endpoints.js registry/<id>.json [...]

const fs = require("node:fs");

// 各网络上官方 USDC 合约地址（小写）
const USDC = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};
const USDC_DECIMALS = 6;

// x402 v1 的网络名 → CAIP-2
const V1_NETWORKS = { base: "eip155:8453", "base-sepolia": "eip155:84532" };

// 十进制金额字符串 → 原子单位，避免浮点误差
function toAtomic(price, decimals) {
  const [whole, frac = ""] = price.split(".");
  return BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals)).toString();
}

function formatAtomic(amount, decimals) {
  const s = String(amount).padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
}

async function readPaymentRequired(res) {
  const header = res.headers.get("payment-required");
  if (header) return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  // x402 v1 把支付要求放在响应体里
  const body = await res.json().catch(() => null);
  if (body && Array.isArray(body.accepts)) return body;
  return null;
}

async function checkAction(manifest, action) {
  const { url, method, content_type: contentType } = action.endpoint;
  const init = { method, redirect: "manual", signal: AbortSignal.timeout(20000) };
  if (method !== "GET") {
    init.headers = { "content-type": contentType };
    init.body = JSON.stringify(action.example.request);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return [`无法访问 ${method} ${url}：${err.cause?.message || err.message}`];
  }
  if (res.status !== 402) return [`不带付款的请求应返回 402，实际返回 ${res.status}`];

  let paymentRequired;
  try {
    paymentRequired = await readPaymentRequired(res);
  } catch (err) {
    return [`无法解析 402 中的支付要求：${err.message}`];
  }
  if (!paymentRequired) return ["402 响应中没有支付要求（PAYMENT-REQUIRED 响应头或响应体中的 accepts）"];

  const network = manifest.payment.network;
  const expectedAsset = USDC[network];
  const expectedAmount = toAtomic(action.price, USDC_DECIMALS);

  const options = paymentRequired.accepts.map((a) => ({
    scheme: a.scheme,
    network: V1_NETWORKS[a.network] || a.network,
    asset: String(a.asset).toLowerCase(),
    amount: String(a.amount ?? a.maxAmountRequired),
  }));

  const onNetwork = options.filter((o) => o.scheme === "exact" && o.network === network);
  if (onNetwork.length === 0) {
    const offered = options.map((o) => `${o.scheme}@${o.network}`).join(", ");
    return [`402 中没有 ${network} 上的 exact 付款方式，实际提供：${offered || "无"}`];
  }
  const usdc = onNetwork.filter((o) => o.asset === expectedAsset);
  if (usdc.length === 0) {
    return [`${network} 上收取的币种不是官方 USDC（${expectedAsset}），实际为 ${onNetwork.map((o) => o.asset).join(", ")}`];
  }
  if (!usdc.some((o) => o.amount === expectedAmount)) {
    const actual = usdc.map((o) => formatAtomic(o.amount, USDC_DECIMALS)).join(", ");
    return [`金额不一致：manifest 为 ${action.price} USDC，402 要求 ${actual} USDC`];
  }
  return [];
}

async function checkManifest(manifest) {
  const results = [];
  for (const action of manifest.actions) {
    results.push({ action: action.id, errors: await checkAction(manifest, action) });
  }
  return results;
}

module.exports = { checkManifest };

if (require.main === module) {
  (async () => {
    const files = process.argv.slice(2);
    if (files.length === 0) {
      console.error("用法：node scripts/check-endpoints.js registry/<id>.json [...]");
      process.exit(1);
    }
    let failed = 0;
    for (const file of files) {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const { action, errors } of await checkManifest(manifest)) {
        const label = `${file} → ${action}`;
        if (errors.length) {
          failed++;
          console.error(`✗ ${label}`);
          for (const e of errors) console.error(`    ${e}`);
        } else {
          console.log(`✓ ${label}`);
        }
      }
    }
    if (failed) process.exit(1);
  })();
}
