#!/usr/bin/env node
// Maestro self-test (`maestro selftest`): run it after changing Maestro itself. It never calls a model and never
// spends money. Checks: syntax of every script, the main CLI commands, provider rules, every dashboard API route,
// and - when playwright-core and Edge/Chrome are available - real clicks on the dashboard's key controls.
// Uses a throwaway data folder, so the user's ratings, settings and budgets are not touched.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OC = path.join(DIR, "oc.mjs");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-selftest-"));
for (const f of ["models.json", "stats.json"]) {
  const src = path.join(process.env.MAESTRO_DATA || DIR, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DATA, f));
}
const ENV = { ...process.env, MAESTRO_DATA: DATA };
const quick = process.argv.includes("--quick"); // skip the browser part

let failed = 0, passed = 0, skipped = 0;
const ok = (name) => { passed++; console.log(`  ✔ ${name}`); };
const bad = (name, why) => { failed++; console.log(`  ✘ ${name}: ${String(why).split("\n")[0].slice(0, 200)}`); };
const skip = (name, why) => { skipped++; console.log(`  - ${name} (skipped: ${why})`); };
async function check(name, fn) {
  try { const r = await fn(); if (r === "skip") return; ok(name); } catch (e) { bad(name, e?.message || e); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. syntax ----------
console.log("syntax");
const scripts = [
  ...fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => path.join(DIR, f)),
  ...fs.readdirSync(path.join(DIR, "web")).filter((f) => f.endsWith(".js")).map((f) => path.join(DIR, "web", f)),
];
for (const f of scripts) {
  await check(path.relative(DIR, f), () => {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    assert(r.status === 0, r.stderr);
  });
}

// ---------- 2. CLI ----------
console.log("cli");
const oc = (args, timeout = 90000) => spawnSync(process.execPath, [OC, ...args], { encoding: "utf8", env: ENV, timeout, windowsHide: true });
const cli = [
  [["help"], /usage|commands|oc /i],
  [["list"], /./s],
  [["models"], /tier|runner/i],
  [["pick", "--kind", "hard"], /->/],
  [["pick", "--kind", "ui"], /->/],
  [["limits"], /maxTotal/],
  [["keys"], /provider.*billing/i],
];
for (const [args, re] of cli) {
  await check(`maestro ${args.join(" ")}`, () => {
    const r = oc(args);
    assert(r.status === 0, `exit ${r.status}: ${r.stderr || r.stdout}`);
    assert(re.test(r.stdout), `unexpected output: ${r.stdout.slice(0, 120)}`);
  });
}
await check("maestro stop without id is refused", () => {
  const r = oc(["stop"]);
  assert(r.status !== 0 && /id/i.test(r.stderr + r.stdout), "an empty id must not stop anything");
});
await check("maestro keys enable/budget writes only on/off + budget", () => {
  assert(oc(["keys", "enable", "openrouter", "--budget", "1.5"]).status === 0, "enable failed");
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, "providers.json"), "utf8"));
  assert(saved.providers.openrouter.enabled === true && saved.providers.openrouter.budgetUsd === 1.5, JSON.stringify(saved));
  assert(!/key/i.test(JSON.stringify(saved).replace(/"providers"/, "")), "no key material may be stored");
  assert(oc(["keys", "disable", "openrouter"]).status === 0, "disable failed");
});

// ---------- 3. provider rules ----------
console.log("providers");
process.env.MAESTRO_DATA = DATA;
const P = await import(pathToFileURL(path.join(DIR, "providers.mjs")).href);
await check("provider of a model id", () => {
  assert(P.providerOf("openrouter/qwen/qwen3.5-72b:free") === "openrouter", "openrouter");
  assert(P.providerOf("opencode/deepseek-v4.1-flash-free") === null, "opencode is not an API-key provider");
});
await check("paid vs free models", () => {
  assert(P.isPaidModel("openai/gpt-5.6-sol") === true, "openai is paid");
  assert(P.isPaidModel("openrouter/qwen/qwen3.5-72b:free") === false, ":free models cost nothing");
  assert(P.isPaidModel("groq/llama-4-maverick") === false, "groq has a free tier");
});
await check("disabled provider / missing budget block paid models", () => {
  P.saveProviderSetting("openai", { enabled: false, budgetUsd: 0 });
  assert(/tắt|off/i.test(P.providerBlock("openai/gpt-5.6-sol")), "disabled provider must block");
  P.saveProviderSetting("openai", { enabled: true, budgetUsd: 0 });
  assert(/ngân sách|budget/i.test(P.providerBlock("openai/gpt-5.6-sol")), "budget 0 must block paid models");
  P.saveProviderSetting("openai", { enabled: true, budgetUsd: 0.01 });
  assert(P.providerBlock("openai/gpt-5.6-sol") === "", "budget left: usable");
  P.addSpend("openai/gpt-5.6-sol", 0.02);
  assert(/\$/.test(P.providerBlock("openai/gpt-5.6-sol")), "spent >= budget must block until tomorrow");
});
await check("family priors rank new models", () => {
  assert(P.familyPrior("anthropic/claude-sonnet-4-6") >= 0.75, "claude sonnet 4.6");
  assert(P.familyPrior("groq/llama-4-maverick") < 0.6, "llama 4");
  assert(P.levelFromQuality(0.9) === 5 && P.levelFromQuality(0.5) === 2, "levels");
});

// ---------- 4. dashboard server ----------
console.log("dashboard");
const port = 47000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(DIR, "dash-web.mjs"), "--port", String(port)], {
  env: ENV, stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
});
let serverErr = "";
server.stderr.on("data", (d) => { serverErr += d; });
const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(15000) }); return { status: r.status, text: await r.text() }; };
const post = (p, body, headers = { "X-OC-Action": "1" }) => fetch(base + p, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
}).then(async (r) => ({ status: r.status, text: await r.text() }));
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await get("/api/state")).status === 200; } catch { await sleep(250); } }
if (!up) bad("server starts", serverErr || "no answer on " + base);
else {
  ok("server starts");
  for (const p of ["/api/state", "/api/health", "/api/providers", "/api/timeline?hours=6", "/api/metrics?range=24h", "/api/batches", "/api/models"]) {
    await check(`GET ${p}`, async () => { const r = await get(p); assert(r.status === 200, "HTTP " + r.status); JSON.parse(r.text); });
  }
  for (const p of ["/", "/app", "/app.js", "/i18n.js", "/charts.js", "/styles.css", "/intro.js", "/intro.css", "/fox.png", "/fox-avatar.png", "/fox-full.webp"]) {
    await check(`GET ${p}`, async () => { const r = await get(p); assert(r.status === 200, "HTTP " + r.status); });
  }
  await check("/app restores saved preferences", async () => {
    assert((await post("/api/prefs", { key: "oc-theme", value: '"dark"' })).status === 200, "save");
    const html = (await get("/app")).text;
    assert(/window\.ocSyncPref/.test(html) && /"oc-theme":"\\"dark\\""/.test(html), "boot script missing");
  });
  await check("POST without the CSRF header is refused", async () => {
    assert((await post("/api/prefs", { key: "oc-theme", value: '"light"' }, {})).status === 403, "expected 403");
  });
  await check("invalid preference / provider rejected", async () => {
    assert((await post("/api/prefs", { key: "evil", value: "x" })).status === 400, "pref key");
    assert((await post("/api/provider/nope", { enabled: true })).status === 400, "provider id");
  });
  await check("provider setting saved", async () => {
    const r = await post("/api/provider/groq", { enabled: true });
    assert(r.status === 200 && JSON.parse(r.text).enabled === true, r.text);
  });
  await check("health reports the machine limit", async () => {
    const h = JSON.parse((await get("/api/health")).text);
    assert(h.maxParallel >= 2 && h.cores >= 1, JSON.stringify(h).slice(0, 120));
  });

  // ---------- 5. browser (optional) ----------
  console.log("browser");
  let chromium = null;
  if (!quick) {
    const candidates = [
      process.env.MAESTRO_PLAYWRIGHT,
      path.join(os.homedir(), ".claude", "skills", "ui-template-picker", "scout", "node_modules", "playwright-core", "index.mjs"),
      path.join(DIR, "..", "ui-template-picker", "scout", "node_modules", "playwright-core", "index.mjs"),
    ].filter(Boolean);
    for (const c of candidates) {
      if (!fs.existsSync(c)) continue;
      try { chromium = (await import(pathToFileURL(c).href)).chromium; break; } catch {}
    }
  }
  if (!chromium) skip("dashboard clicks", quick ? "--quick" : "playwright-core not found (set MAESTRO_PLAYWRIGHT)");
  else {
    let browser = null;
    for (const channel of ["msedge", "chrome", undefined]) {
      try { browser = await chromium.launch(channel ? { channel } : {}); break; } catch {}
    }
    if (!browser) skip("dashboard clicks", "no Edge/Chrome/Chromium to launch");
    else {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/app#/tong-quan");
      await page.waitForTimeout(1500);
      await check("notification bell opens the panel", async () => {
        await page.click("#bellBtn");
        await page.waitForTimeout(300);
        assert(await page.isVisible("#notifPanel"), "panel stays hidden");
        await page.click("#bellBtn");
      });
      await check("range buttons switch", async () => {
        await page.click('#rangeSeg button[data-range="24h"]');
        await page.waitForTimeout(300);
        assert(await page.getAttribute('#rangeSeg button[data-range="24h"]', "class").then((c) => /active/.test(c || "")), "24h not active");
        await page.click('#rangeSeg button[data-range="today"]');
      });
      await check("sidebar toggle collapses and expands", async () => {
        await page.click("#collapseBtn");
        await page.waitForTimeout(300);
        const collapsed = await page.evaluate(() => document.body.classList.contains("side-collapsed"));
        await page.click("#collapseBtn");
        assert(collapsed, "sidebar did not collapse");
      });
      await check("timeline renders with window controls", async () => {
        await page.goto(base + "/app#/dong-thoi-gian");
        await page.waitForTimeout(1500);
        await page.click('#tlWinSeg button[data-hours="12"]');
        await page.waitForTimeout(400);
        assert(await page.isVisible("#tlLabel"), "no window label");
        const html = await page.innerHTML("#ganttWrap");
        assert(html.length > 20 && !/Đang tải|Loading/.test(html), "gantt not rendered");
      });
      await check("settings shows the providers card", async () => {
        await page.goto(base + "/app#/cai-dat");
        await page.waitForTimeout(1500);
        const txt = await page.innerText("#view-settings");
        assert(/Nhà cung cấp|Providers/.test(txt) && /OpenRouter/.test(txt), "providers card missing");
      });
      await check("no JavaScript errors on any page", async () => {
        for (const h of ["cong-viec", "ke-hoach", "model", "tien-trinh", "tong-quan"]) {
          await page.goto(base + "/app#/" + h);
          await page.waitForTimeout(900);
        }
        assert(!errors.length, errors.join(" | "));
      });
      await browser.close();
    }
  }
}
server.kill();
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(failed ? 1 : 0);
