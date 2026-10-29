// Quality bench for opencode models. Each task is a small, realistic job scored by hidden checks
// that the model never sees, so scores reflect real ability rather than self-reported success.
//   fix   - fix 4 bugs so an existing node:test suite passes            -> kinds: quick, code, hard
//   code  - implement 3 utilities from a spec, 24 hidden assertions     -> kinds: code, hard
//   ui    - React + TS PricingCard with motion: tsc + SSR render checks -> kinds: ui, hard
// Results go to models.json (models[<id>].bench[<task>] = { score, seconds, status, tested, error }).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { availableModels, loadModels, saveModels, runJob, oneLine, isInterrupted } from "./oc.mjs";

export const TASKS = ["fix", "code", "ui", "hard"];
const DEPS_DIR = path.join(os.tmpdir(), "oc-bench-deps");
const DEPS = ["react@19", "react-dom@19", "motion", "typescript", "esbuild", "@types/react@19", "@types/react-dom@19"];

function ensureDeps() {
  if (fs.existsSync(path.join(DEPS_DIR, "node_modules", "esbuild")) && fs.existsSync(path.join(DEPS_DIR, "node_modules", "motion"))) return;
  console.log(`installing bench deps in ${DEPS_DIR} (one time)...`);
  fs.mkdirSync(DEPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEPS_DIR, "package.json"), JSON.stringify({ name: "oc-bench-deps", private: true, type: "module" }));
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...DEPS], { cwd: DEPS_DIR, shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`npm install failed: ${oneLine(r.stderr, 400)}`);
}

// A real copy, not a junction: a link pointing outside the task dir counts as an external directory for
// opencode, which `opencode run` cannot ask about (the job ends "blocked").
function copyDeps(dir) {
  fs.cpSync(path.join(DEPS_DIR, "node_modules"), path.join(dir, "node_modules"), { recursive: true });
}

const nodeRun = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60000 });

// ---------------- task: fix ----------------
const CART_BUGGY = `// Shopping cart helpers. Amounts are in VND.
export function subtotal(items) {
  let s = 0;
  for (let i = 1; i < items.length; i++) s += items[i].price * items[i].qty;
  return s;
}

export function applyDiscount(amount, code) {
  const codes = { SAVE10: 0.1, HALF: 0.5 };
  const rate = codes[code.toLowerCase()] ?? 0;
  return Math.round(amount * (1 - rate) * 100) / 100;
}

export function shipping(amount) {
  return amount > 500000 ? 0 : 30000;
}

export function total(items, code) {
  const s = subtotal(items);
  const d = applyDiscount(s, code);
  return d + shipping(s);
}
`;
const CART_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { subtotal, applyDiscount, shipping, total } from "./cart.mjs";

const items = [{ price: 100000, qty: 2 }, { price: 50000, qty: 1 }];

test("subtotal sums every line", () => {
  assert.equal(subtotal(items), 250000);
  assert.equal(subtotal([]), 0);
});

test("discount codes are case-insensitive", () => {
  assert.equal(applyDiscount(200000, "save10"), 180000);
  assert.equal(applyDiscount(200000, "HALF"), 100000);
  assert.equal(applyDiscount(200000, "nope"), 200000);
});

test("shipping is free from 500000", () => {
  assert.equal(shipping(500000), 0);
  assert.equal(shipping(499999), 30000);
});

test("total charges shipping on the discounted amount", () => {
  const big = [{ price: 520000, qty: 1 }];
  assert.equal(total(big, "SAVE10"), 468000 + 30000);
  assert.equal(total(big, ""), 520000);
});
`;

const FIX = {
  scope: "cart.mjs",
  brief: `# Bench fix: make the cart tests pass
The tests in \`cart.test.mjs\` fail. Find and fix the bugs in \`cart.mjs\` so that \`node --test\` passes.
Do not modify \`cart.test.mjs\`. Keep the exported function names and signatures.
Acceptance: \`node --test\` reports 4 passing tests and 0 failing.
`,
  setup(dir) {
    fs.writeFileSync(path.join(dir, "cart.mjs"), CART_BUGGY);
    fs.writeFileSync(path.join(dir, "cart.test.mjs"), CART_TEST);
  },
  check(dir) {
    // Run the pristine test copy so an edited test file cannot inflate the score.
    fs.writeFileSync(path.join(dir, "cart.check.test.mjs"), CART_TEST);
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "cart.check.test.mjs"], { cwd: dir, encoding: "utf8", timeout: 60000 });
    const pass = Number((r.stdout.match(/^# pass (\d+)/m) || [])[1] || 0);
    return { passed: pass, total: 4 };
  },
};

// ---------------- task: code ----------------
const CODE_CHECK = `
import * as m from "./src/text.mjs";
let passed = 0, total = 0;
const eq = (fn, args, want) => { total++; try { if (Object.is(fn(...args), want)) passed++; } catch {} };
const throws = (fn, args, type) => { total++; try { fn(...args); } catch (e) { if (!type || e instanceof type) passed++; } };
const { slugify, parseDuration, formatBytes } = m;
for (const [i, o] of [["  Xin chào Thế Giới!  ", "xin-chao-the-gioi"], ["Đà Nẵng -- 2026", "da-nang-2026"], ["", ""], ["Hello___World", "hello-world"], ["Crème Brûlée", "creme-brulee"]]) eq(slugify, [i], o);
for (const [i, o] of [["1h30m", 5400], ["45s", 45], ["2h", 7200], ["1h 5m 10s", 3910], ["90m", 5400], ["1H30M", 5400]]) eq(parseDuration, [i], o);
for (const i of ["abc", "10x", "", "h"]) throws(parseDuration, [i]);
for (const [i, o] of [[0, "0 B"], [1023, "1023 B"], [1024, "1.0 KB"], [1536, "1.5 KB"], [1048576, "1.0 MB"], [1.5 * 1024 ** 3, "1.5 GB"]]) eq(formatBytes, [i], o);
for (const i of [-1, Infinity, NaN]) throws(formatBytes, [i], RangeError);
console.log(JSON.stringify({ passed, total }));
`;

const CODE = {
  scope: "src,test",
  brief: `# Bench code: text utilities
Create \`src/text.mjs\` (ES module, no dependencies) exporting three functions:

1. \`slugify(str)\`: lowercase; remove diacritics from Vietnamese/Latin letters (including "đ" -> "d");
   replace every run of characters other than a-z and 0-9 with a single "-"; trim "-" from both ends.
   Examples: slugify("  Xin chào Thế Giới!  ") === "xin-chao-the-gioi"; slugify("Đà Nẵng -- 2026") === "da-nang-2026"; slugify("") === "".
2. \`parseDuration(str)\`: parse durations made of number+unit parts, units h, m, s (case-insensitive), optional spaces
   between parts, and return the total number of seconds.
   Examples: "1h30m" -> 5400, "45s" -> 45, "2h" -> 7200, "1h 5m 10s" -> 3910, "90m" -> 5400.
   Throw an Error for invalid input: empty string, unknown unit, missing number (e.g. "", "abc", "10x").
3. \`formatBytes(n)\`: 0 -> "0 B", 1023 -> "1023 B", 1024 -> "1.0 KB", 1536 -> "1.5 KB", 1048576 -> "1.0 MB".
   Units B, KB, MB, GB, TB (base 1024); bytes as an integer, larger units with exactly one decimal.
   Throw a RangeError for negative or non-finite input.

Also write tests in \`test/text.test.mjs\` using node:test and node:assert, covering the examples above.
Acceptance: \`node --test\` passes.
`,
  setup() {},
  check(dir) {
    fs.writeFileSync(path.join(dir, "check.mjs"), CODE_CHECK);
    const r = nodeRun(["check.mjs"], dir);
    try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return { passed: 0, total: 24 }; }
  },
};

// ---------------- task: ui ----------------
const UI_TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", strict: true, noEmit: true, skipLibCheck: true },
  include: ["components"],
}, null, 2);

const UI_CHECK = `
import fs from "node:fs";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const src = fs.readFileSync("components/PricingCard.tsx", "utf8");
const out = transformSync(src, { loader: "tsx", jsx: "automatic", format: "esm", target: "es2020" }).code;
fs.mkdirSync(".check", { recursive: true });
fs.writeFileSync(".check/PricingCard.mjs", out);
const { PricingCard } = await import("./.check/PricingCard.mjs");
let passed = 0, total = 0;
const ok = (c) => { total++; if (c) passed++; };
let a = "", b = "";
try { a = renderToStaticMarkup(createElement(PricingCard, { name: "Pro", price: 199000, features: ["A", "B", "C"] })); } catch {}
try { b = renderToStaticMarkup(createElement(PricingCard, { name: "Team", price: 1990000, period: "year", features: ["X"], highlighted: true, ctaLabel: "Chọn gói" })); } catch {}
const count = (s, re) => (s.match(re) || []).length;
ok(/<article[\\s>]/.test(a));
ok(/<h3[^>]*>[^<]*Pro/.test(a));
ok(a.includes("199.000") && a.includes("₫/tháng"));
ok(count(a, /<li[\\s>]/g) === 3);
ok(/<button[^>]*type="button"[^>]*>[^<]*Get started/.test(a) && !a.includes("aria-current"));
ok(b.includes("1.990.000") && b.includes("₫/năm"));
ok(b.includes('aria-current="true"'));
ok(b.includes("Phổ biến") && b.includes("Chọn gói"));
ok(count(b, /<li[\\s>]/g) === 1);
ok(/from\\s+["']motion\\/react["']/.test(src) && /whileHover/.test(src));
ok(/0\\.22\\s*,\\s*1\\s*,\\s*0\\.36\\s*,\\s*1/.test(src));
console.log(JSON.stringify({ passed, total }));
`;

const UI = {
  scope: "components",
  brief: `# Bench ui: PricingCard component
Create \`components/PricingCard.tsx\` (React 19 + TypeScript strict) with a named export \`PricingCard\`.

Props: \`{ name: string; price: number; period?: "month" | "year"; features: string[]; highlighted?: boolean; ctaLabel?: string; onSelect?: () => void }\`
(defaults: period "month", ctaLabel "Get started").

Render:
- an \`<article>\` that is a \`motion.article\` from "motion/react", with \`whileHover={{ y: -6 }}\` and a transition using ease \`[0.22, 1, 0.36, 1]\`
- the plan name in an \`<h3>\`
- the price formatted with \`new Intl.NumberFormat("vi-VN").format(price)\` followed directly by "₫/tháng" (month) or "₫/năm" (year)
- a \`<ul>\` with one \`<li>\` per feature
- a \`<button type="button">\` showing the CTA label, calling \`onSelect\` on click
- when \`highlighted\` is true: \`aria-current="true"\` on the article and a visible badge with the text "Phổ biến"
Use Tailwind-style class names for styling (no CSS files needed).

Packages are already installed (react, react-dom, motion, typescript). Do not install packages and do not edit tsconfig.json.
Acceptance: \`node node_modules/typescript/bin/tsc -p tsconfig.json\` exits with no errors.
`,
  setup(dir) {
    copyDeps(dir);
    fs.mkdirSync(path.join(dir, "components"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), UI_TSCONFIG);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "bench-ui", private: true, type: "module" }));
  },
  check(dir) {
    if (!fs.existsSync(path.join(dir, "components", "PricingCard.tsx"))) return { passed: 0, total: 14 };
    // Type-check with a pristine tsconfig (worth 3 of 14 points), then render checks (11 points).
    fs.writeFileSync(path.join(dir, "tsconfig.check.json"), UI_TSCONFIG);
    const tsc = nodeRun([path.join(DEPS_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.check.json"], dir);
    const tscOk = tsc.status === 0;
    fs.writeFileSync(path.join(dir, "check.mjs"), UI_CHECK);
    const r = nodeRun(["check.mjs"], dir);
    let res = { passed: 0, total: 11 };
    try { res = JSON.parse(r.stdout.trim().split("\n").pop()); } catch {}
    return { passed: res.passed + (tscOk ? 3 : 0), total: res.total + 3 };
  },
};

// ---------------- task: hard ----------------
const CSV = `id,product,qty,price,cancelled,coupon
ORD-001,Widget,2,100000,false,SAVE10
ORD-002,Gadget,1,500000,false,
ORD-003,Widget,3,100000,true,
ORD-004,Gadget,2,250000,false,`;

const PARSE_BUGGY = `// Parse CSV-like order lines. Amounts are in VND.
export function parseOrders(text) {
  if (text == null) return [];
  const lines = String(text).trim().split(/\\r?\\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const orders = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const [id, product, qty, price, cancelled, coupon = ""] = parts;
    orders.push({
      id: String(id).trim(),
      product: String(product).trim(),
      qty: qty.trim(),
      price: Number(price.trim()),
      cancelled: String(cancelled).trim() === "true",
      coupon: String(coupon ?? "").trim(),
    });
  }
  return orders;
}
`;

const PRICING_BUGGY = `// Prices, discounts and tax. Amounts are in VND.
const TAX_RATE = 0.08;
const COUPONS = { SAVE10: 0.10, HALF: 0.50 };

function tierRate(subtotal) {
  if (subtotal > 5000000) return 0.10;
  if (subtotal > 1000000) return 0.05;
  return 0;
}
function couponRate(code) {
  return COUPONS[String(code).toUpperCase()] ?? 0;
}

export function orderTotal(id, orders) {
  const lines = orders.filter(o => o.id === id);
  if (!lines.length) return 0;
  const coupon = Math.max(...lines.map(o => couponRate(o.coupon)));
  const subtotal = lines.reduce((s, o) => s + o.price * o.qty, 0);
  const tier = tierRate(subtotal);
  const rate = coupon + tier;
  return lines.reduce((s, o) => s + Math.round(o.price * o.qty * (1 - rate) * (1 + TAX_RATE)), 0);
}
`;

const INVENTORY_BUGGY = `// Stock reservation.
export function reserveStock(orders, stock) {
  const reserved = {};
  for (const o of orders) {
    reserved[o.product] = (reserved[o.product] || 0) + o.qty;
  }
  return reserved;
}
`;

const REPORT_BUGGY = `// Summary report using the other modules.
import { orderTotal } from "./pricing.mjs";

export function summary(orders) {
  let revenue = 0, count = 0, cancelled = 0;
  const byProduct = {};
  for (const o of orders) {
    revenue += orderTotal(o.id, orders);
    count++;
    byProduct[o.product] = (byProduct[o.product] || 0) + o.qty;
  }
  return { revenue, orderCount: count, cancelledCount: cancelled, byProduct };
}
`;

const VISIBLE_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrders } from "../src/parse.mjs";
import { orderTotal } from "../src/pricing.mjs";
import { reserveStock } from "../src/inventory.mjs";
import { summary } from "../src/report.mjs";

const CSV = \`id,product,qty,price,cancelled,coupon
ORD-001,Widget,2,100000,false,SAVE10
ORD-002,Gadget,1,500000,false,
ORD-003,Widget,3,100000,true,
ORD-004,Gadget,2,250000,false,\`;

test("parse returns numeric quantities and booleans", () => {
  const orders = parseOrders(CSV);
  assert.equal(orders.length, 4);
  assert.equal(typeof orders[0].qty, "number");
  assert.equal(orders[0].qty, 2);
  assert.equal(typeof orders[0].cancelled, "boolean");
  assert.equal(orders[2].cancelled, true);
});

test("order totals with coupon", () => {
  const orders = parseOrders(CSV);
  assert.equal(orderTotal("ORD-001", orders), 194400);
  assert.equal(orderTotal("ORD-002", orders), 540000);
});

test("unknown order totals zero", () => {
  const orders = parseOrders(CSV);
  assert.equal(orderTotal("NOPE", orders), 0);
});

test("cancelled orders are not reserved or oversold", () => {
  const orders = parseOrders(CSV);
  const stock = { Widget: 4, Gadget: 10 };
  const reserved = reserveStock(orders, stock);
  assert.equal(reserved.Widget, 2);
  assert.equal(typeof reserved.Widget, "number");
});

test("report excludes cancelled orders", () => {
  const orders = parseOrders(CSV);
  const s = summary(orders);
  assert.equal(s.orderCount, 3);
  assert.equal(s.cancelledCount, 1);
});
`;

const HARD_CHECK = `import assert from "node:assert/strict";
import * as parse from "./src/parse.mjs";
import * as pricing from "./src/pricing.mjs";
import * as inventory from "./src/inventory.mjs";
import * as report from "./src/report.mjs";

let passed = 0, total = 0;
const check = (cond, name) => { total++; try { assert.ok(cond); passed++; } catch (e) { console.log("FAIL", name, "-", e.message); } };
const equal = (actual, expected, name) => { total++; try { assert.deepStrictEqual(actual, expected); passed++; } catch (e) { console.log("FAIL", name, "- got", String(actual), "want", String(expected)); } };

const orders = parse.parseOrders(\`${CSV}\`);

check(orders.length === 4, "parse row count");
check(typeof orders[0].qty === "number", "qty is a number");
check(orders[0].qty === 2, "qty value");
check(typeof orders[0].cancelled === "boolean", "cancelled is a boolean");
check(orders[2].cancelled === true, "cancelled value");
check(parse.parseOrders("").length === 0, "empty input");
let malformed; try { malformed = parse.parseOrders("id,product,qty,price,cancelled,coupon\\nBAD,only,three\\nORD-1,Thing,1,100,false,"); } catch { malformed = null; }
equal(malformed?.length, 1, "malformed line skipped");

equal(pricing.orderTotal("ORD-001", orders), 194400, "coupon total");
equal(pricing.orderTotal("ORD-002", orders), 540000, "no-discount total");
equal(pricing.orderTotal("NOPE", orders), 0, "unknown id");
equal(pricing.orderTotal("X", [{ id: "X", product: "P", qty: 1, price: 1000, cancelled: true, coupon: "" }]), 0, "cancelled total is zero");
equal(pricing.orderTotal("L", [{ id: "L", product: "P", qty: 2, price: 100000, cancelled: false, coupon: "save10" }]), 194400, "coupon case-insensitive");

const B = { id: "B", product: "P", qty: 10, price: 120000, cancelled: false, coupon: "" };
equal(pricing.orderTotal("B", [B]), 1231200, "tier 5% at 1.200.000");
const C = { id: "C", product: "P", qty: 10, price: 100000, cancelled: false, coupon: "" };
equal(pricing.orderTotal("C", [C]), 1026000, "boundary 1.000.000 -> 5%");
const D = { id: "D", product: "P", qty: 50, price: 100000, cancelled: false, coupon: "" };
equal(pricing.orderTotal("D", [D]), 4860000, "boundary 5.000.000 -> 10%");
const E = { id: "E", product: "P", qty: 20, price: 100000, cancelled: false, coupon: "SAVE10" };
equal(pricing.orderTotal("E", [E]), 1944000, "coupon beats tier 5% at 2.000.000");
const F = { id: "F", product: "P", qty: 100, price: 100000, cancelled: false, coupon: "SAVE10" };
equal(pricing.orderTotal("F", [F]), 9720000, "no stacking at 10.000.000");
const G = { id: "G", product: "P", qty: 60, price: 100000, cancelled: false, coupon: "HALF" };
equal(pricing.orderTotal("G", [G]), 3240000, "HALF 50%");
const H = { id: "H", product: "P", qty: 1, price: 999999, cancelled: false, coupon: "" };
equal(pricing.orderTotal("H", [H]), 1079999, "rounds to whole VND");
const M = [
  { id: "M", product: "P", qty: 1, price: 1055, cancelled: false, coupon: "" },
  { id: "M", product: "P", qty: 1, price: 1055, cancelled: false, coupon: "" },
];
equal(pricing.orderTotal("M", M), 2279, "rounds on total not per line");

const invOrders = [
  { id: "1", product: "Widget", qty: 2, cancelled: false },
  { id: "2", product: "Widget", qty: 3, cancelled: true },
  { id: "3", product: "Gadget", qty: 3, cancelled: false },
];
const reserved = inventory.reserveStock(invOrders, { Widget: 4, Gadget: 5 });
equal(reserved, { Widget: 2, Gadget: 3 }, "cancelled skipped, no oversell");
check(Object.values(reserved).every(v => typeof v === "number"), "reserved values are numbers");
equal(inventory.reserveStock([{ id: "9", product: "P", qty: 10, cancelled: false }], { P: 3 }), {}, "oversell refused");

const s = report.summary(orders);
equal(s.orderCount, 3, "report excludes cancelled from count");
equal(s.cancelledCount, 1, "report counts cancelled");
equal(s.revenue, 1274400, "report revenue excludes cancelled");
equal(s.byProduct.Widget, 2, "byProduct Widget");
equal(s.byProduct.Gadget, 3, "byProduct Gadget");
equal(report.summary([E]).tierDiscountTotal, 0, "no tier discount when coupon wins");
const s2 = report.summary([B]);
equal(s2.tierDiscountTotal, 60000, "tierDiscountTotal field");
equal(s2.byProduct.P, 10, "byProduct");
equal(report.summary([]), { revenue: 0, orderCount: 0, cancelledCount: 0, byProduct: {}, tierDiscountTotal: 0 }, "empty summary");

console.log(JSON.stringify({ passed, total }));
`;

const HARD_BRIEF = `# Bench hard: order-processing pipeline

Fix a small, dependency-free Node ESM project under \`src/\` so the visible tests pass, then implement tiered discounts.

Files:
- \`src/parse.mjs\` - parse CSV order lines (header: id,product,qty,price,cancelled,coupon) into { id, product, qty, price, cancelled, coupon } objects. qty and price must be numbers; cancelled must be a boolean ("true" -> true).
- \`src/pricing.mjs\` - order totals. Coupon codes: SAVE10 = 10%, HALF = 50%, unknown = 0%. Tiered discounts on the subtotal: 5% from 1.000.000 VND, 10% from 5.000.000 VND. Never stack - apply the larger of coupon or tier, never both. Tax 8% on the discounted subtotal. Round once to whole VND on the final total (not per line).
- \`src/inventory.mjs\` - reserveStock(orders, stock): skip cancelled orders, refuse to reserve more than stock[product] allows, reserved values are numbers.
- \`src/report.mjs\` - summary(orders): { revenue, orderCount, cancelledCount, byProduct, tierDiscountTotal }. tierDiscountTotal is new: total VND discounted by tiers for orders where the tier rate won (>= coupon rate and > 0).

Rules (implement exactly):
1. parse turns qty/price into numbers; cancelled is "true" -> true.
2. An order total sums price * qty over its non-cancelled lines only.
3. Coupon rates: SAVE10 -> 0.10, HALF -> 0.50, unknown -> 0.
4. Tier rates: subtotal >= 1.000.000 -> 0.05; subtotal >= 5.000.000 -> 0.10; else 0.
5. Apply max(coupon, tier) - never add them. Tax 8% on the discounted subtotal. Return Math.round(subtotal * (1 - rate) * 1.08).
6. reserveStock skips cancelled orders and lines with qty > stock[product]; reserved values are numbers.
7. report excludes cancelled orders from revenue and orderCount, counts them in cancelledCount, sums qty per product in byProduct, and adds tierDiscountTotal.

Worked examples (VND):
- ORD-001: 2 x 100.000 with SAVE10 -> subtotal 200.000, rate 10% (coupon), 180.000 x 1.08 = 194.400.
- ORD-002: 10 x 120.000 no coupon -> subtotal 1.200.000, tier 5%, 1.140.000 x 1.08 = 1.231.200.
- ORD-003: 50 x 200.000 with SAVE10 -> subtotal 10.000.000, tier 10% = coupon 10%, no stacking: 9.000.000 x 1.08 = 9.720.000 (not 15%).

Boundaries: subtotal exactly 1.000.000 -> 5%; exactly 5.000.000 -> 10%. Subtotal 2.000.000 with SAVE10 -> coupon 10% wins over tier 5%. Empty input -> zero totals.

Make \`node --test\` pass in \`test/visible.test.mjs\` (do not modify it) and implement the behavior above. Hidden checks import your \`src/\` modules and assert every rule, including edge cases not shown in the visible tests: empty input, cancelled orders, rounding to whole VND, boundary amounts exactly at the tier thresholds, coupon vs tier.

Scope: \`src\` only. Timeout: 600 s.
`;

const HARD = {
  scope: "src",
  brief: HARD_BRIEF,
  setup(dir) {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/parse.mjs"), PARSE_BUGGY);
    fs.writeFileSync(path.join(dir, "src/pricing.mjs"), PRICING_BUGGY);
    fs.writeFileSync(path.join(dir, "src/inventory.mjs"), INVENTORY_BUGGY);
    fs.writeFileSync(path.join(dir, "src/report.mjs"), REPORT_BUGGY);
    fs.writeFileSync(path.join(dir, "test/visible.test.mjs"), VISIBLE_TEST);
  },
  check(dir) {
    fs.writeFileSync(path.join(dir, "check.mjs"), HARD_CHECK);
    const r = nodeRun(["check.mjs"], dir);
    try { return JSON.parse(r.stdout.trim().split("\\n").pop()); } catch { return { passed: 0, total: 31 }; }
  },
};

const TASK_DEFS = { fix: FIX, code: CODE, ui: UI, hard: HARD };

// Every bench dir denies paths outside itself: a model that wanders (e.g. `find C:/`) gets a fast refusal
// instead of hanging the job. "deny" lets the session continue; "ask" would end it.
const SANDBOX = JSON.stringify({ $schema: "https://opencode.ai/config.json", permission: { external_directory: "deny" } });
const RETRYABLE = new Set(["stalled", "timeout"]);

async function runTask(task, model, root) {
  const def = TASK_DEFS[task];
  const dir = path.join(root, `${model.replace(/[^a-z0-9]+/gi, "_")}-${task}`);
  const brief = dir + ".brief.md";
  fs.writeFileSync(brief, def.brief);
  const t0 = Date.now();
  let job;
  // Free endpoints are bursty: one retry when the provider stalls before any edit, never for wrong answers.
  for (let attempt = 1; attempt <= 2; attempt++) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "opencode.json"), SANDBOX);
    def.setup(dir);
    try {
      const hardTask = task === "hard";
      job = await runJob({
        brief, model, kind: null, fallbacks: 0, dir, scope: def.scope, name: `bench-${task}-${model.split("/").pop()}`,
        timeout: hardTask ? 600 : 480, stall: 240, force: true, quiet: true, noStats: true,
      });
    } catch (e) {
      return { score: 0, seconds: 0, status: "error", error: e.message };
    }
    if (!(RETRYABLE.has(job.status) && !job.filesTouched?.length) || /unavailable/i.test(job.error || "")) break;
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  let res = { passed: 0, total: 1 };
  try { res = def.check(dir); } catch (e) { job.error = job.error || `check failed: ${e.message}`; }
  fs.rmSync(path.join(dir, "node_modules"), { recursive: true, force: true }); // ~66 MB per ui task
  let score = res.total ? res.passed / res.total : 0;
  if (job.outOfScope?.length) score *= 0.9; // discipline matters when jobs run in parallel
  return {
    score: Math.round(score * 1000) / 1000, passed: res.passed, total: res.total, seconds,
    status: job.status, error: job.error ? oneLine(job.error, 200) : undefined, outOfScope: job.outOfScope?.length || 0,
    // The provider never got to work (stalled/timeout before any edit): says nothing about quality.
    infra: job.status !== "done" && !job.filesTouched?.length,
  };
}

export async function bench(models, opt = {}) {
  const tasks = opt.tasks ? String(opt.tasks).split(",").filter((t) => TASK_DEFS[t]) : TASKS;
  if (!models.length) models = availableModels();
  const parallel = Math.max(1, Number(opt.parallel || 4));
  if (tasks.includes("ui")) ensureDeps();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-bench-"));
  console.log(`bench: ${models.length} models x [${tasks.join(", ")}], ${parallel} models at a time, workdir ${root}`);
  const results = {};
  const queue = [...models];
  const worker = async () => {
    while (queue.length && !isInterrupted()) {
      const m = queue.shift();
      results[m] = {};
      for (const t of tasks) {
        if (isInterrupted()) break;
        const r = await runTask(t, m, root);
        if (r.status === "stopped") break; // interrupted: do not record a fake 0%
        results[m][t] = r;
        console.log(`${t.padEnd(5)} ${String(Math.round(r.score * 100)).padStart(3)}%  ${String(r.seconds).padStart(4)}s  ${r.status.padEnd(8)} ${m}${r.error ? "  " + r.error : ""}`);
        // A dead endpoint fails every task the same way; skip the rest to save time.
        if (r.score === 0 && /unavailable|not found|no such model|unauthorized/i.test(r.error || "")) {
          for (const rest of tasks.slice(tasks.indexOf(t) + 1)) results[m][rest] = { ...r, skipped: true };
          break;
        }
      }
      // Save after every model so an interrupted bench keeps what it measured.
      const db = loadModels();
      const tested = new Date().toISOString().slice(0, 10);
      db.models[m] = db.models[m] || {};
      db.models[m].bench = { ...(db.models[m].bench || {}) };
      // Infra-only failures keep the previous measurement instead of recording a fake 0%.
      for (const [t, r] of Object.entries(results[m])) if (!r.infra || !db.models[m].bench[t]) db.models[m].bench[t] = { ...r, tested };
      db.updated = new Date().toISOString();
      saveModels(db);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, models.length) }, worker));

  console.log("\nmodel".padEnd(44) + tasks.map((t) => t.padStart(6)).join("") + "   avg   time");
  const rows = Object.entries(results).map(([m, r]) => {
    const scores = tasks.map((t) => r[t]?.score ?? 0);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const secs = tasks.reduce((a, t) => a + (r[t]?.seconds || 0), 0);
    return { m, scores, avg, secs };
  }).sort((a, b) => b.avg - a.avg || a.secs - b.secs);
  for (const row of rows) {
    console.log(row.m.padEnd(43) + row.scores.map((s) => `${Math.round(s * 100)}%`.padStart(6)).join("") + `${Math.round(row.avg * 100)}%`.padStart(6) + `${row.secs}s`.padStart(7));
  }
  console.log(`\nsaved -> models.json. See ranking per kind: oc models`);
}
