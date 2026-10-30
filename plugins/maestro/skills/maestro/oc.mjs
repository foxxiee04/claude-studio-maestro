#!/usr/bin/env node
// oc - controller for delegating work to opencode (v3).
// Claude plans and verifies; opencode edits. Every run is a "job" with its own folder:
//   <jobs>/<id>/job.json      live state (status, model, steps, tokens, files touched, attempts...)
//   <jobs>/<id>/brief.md      the brief as sent
//   <jobs>/<id>/job.log       human-readable timeline (what dash and `oc log` show)
//   <jobs>/<id>/events.jsonl  raw opencode JSON events
//   <jobs>/<id>/debug.log     opencode stderr
//
// Commands:
//   run <brief> [--kind quick|code|ui|hard] [--model m|auto] [--fallbacks n] [--dir d] [--scope a,b]
//               [--name n] [--timeout s] [--stall s] [--variant v] [--agent a] [--paid] [--no-wait] [--force]
//               model prefixes: opencode/<id> (free) | ollama/<tag> (free, local) | claude/<alias> (paid) | codex/<slug> (paid)
//   batch <plan.json> [--dry-run]      run a plan of jobs with dependencies ("after")
//   pick <kind>                        show the model ranking used for a kind
//   models                             all models: bench scores, real-job stats, rank per kind
//   bench [model ...] [--tasks fix,code,ui] [--parallel n]   quality bench with hidden checks
//   rate <id> good|bad [--note text]   feed Claude's verification back into model ranking
//   list [--all]   report <id>   log <id> [--lines n]   stop <id|lost>   dash [--models]   clean [--days n]
//   pause <id> / resume <id>           freeze / thaw a running job (clocks stop while paused)
//   pause-batch <id|last> / resume-batch <id|last>   stop / allow starting new jobs of a batch
//   web [--port 4790] [--open|--app]   browser dashboard: jobs, live logs, model ranking, running processes
//                                      (--app = standalone Edge window)
// <id> accepts a full id, a unique prefix, a job name, or "last".

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { canStart, modelHeadroom, machineLimits } from "./limits.mjs";
import { PROVIDERS, providerOf, providerInfo, connectedProviders, loadProviderSettings, saveProviderSetting, isPaidModel,
  addSpend, spentToday, providerBlock, familyPrior, levelFromQuality } from "./providers.mjs";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const JOBS = process.env.OC_JOBS_DIR || path.join(os.tmpdir(), "opencode-jobs");
// Bench results and ratings live in MAESTRO_DATA when set (plugin installs), else next to this file.
const DATA_DIR = process.env.MAESTRO_DATA || SKILL_DIR;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const MODELS_FILE = path.join(DATA_DIR, "models.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");
if (DATA_DIR !== SKILL_DIR && !fs.existsSync(MODELS_FILE) && fs.existsSync(path.join(SKILL_DIR, "models.json"))) {
  try { fs.copyFileSync(path.join(SKILL_DIR, "models.json"), MODELS_FILE); } catch {}
}
const DEFAULT_MODEL = process.env.OPENCODE_MODEL || "opencode/big-pickle";
const MAX_PARALLEL = Number(process.env.OC_MAX_PARALLEL || 3);
const DEFAULT_FALLBACKS = Number(process.env.OC_FALLBACKS ?? 2);
const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch"]);
const IS_WIN = process.platform === "win32";
export const KINDS = ["quick", "code", "ui", "hard"];
const KIND_TASKS = { quick: ["fix", "smoke"], code: ["code", "fix"], ui: ["ui"], hard: ["code", "fix", "ui"] };

const LEVELS = {
  "claude/opus": 5, "claude/sonnet": 5, "antigravity/pro": 5,
  "codex/gpt-6-luna": 4, "deepseek-v4.1-flash-free": 4, "glm-5.3-flash-free": 4, "antigravity/flash": 4,
  "claude/haiku": 3, "mimo-v2.6-flash-free": 3, "antigravity/flash_lite": 2,
  "antigravity/claude-opus-4-6-thinking": 5, "antigravity/claude-sonnet-4-6": 5, "antigravity/gemini-3.8-flash-high": 4,
  "antigravity/gemini-3.8-flash-medium": 3, "antigravity/gemini-3.8-flash-low": 2, "antigravity/gpt-oss-120b-medium": 3,
};

function modelLevel(model) {
  const m = String(model);
  // Check explicit matches first (the table uses short names for opencode models)
  if (LEVELS[m] !== undefined) return LEVELS[m];
  const short = m.replace(/^opencode\//, "");
  if (LEVELS[short] !== undefined) return LEVELS[short];
  // Pattern matches
  if (m.startsWith("claude/")) return 3; // claude/haiku is 3, others default 3
  if (m.startsWith("codex/")) return 4;  // codex defaults to 4
  if (m.startsWith("antigravity/")) {
    if (m.startsWith("antigravity/pro")) return 5;
    if (m.startsWith("antigravity/flash")) return 4;
    if (m.startsWith("antigravity/flash_lite")) return 2;
    return 3;
  }
  if (m.startsWith("nemotron/")) return 3;
  if (m.startsWith("ollama/")) return 2;
  // unknown opencode models = 3, unknown ollama = 2
  if (m.startsWith("opencode/")) return 3;
  // Models added with an API key: level from the public-benchmark prior of their family.
  const prior = familyPrior(m);
  return prior === null ? 3 : levelFromQuality(prior);
}
// Failures that say nothing about the model's skill: dead endpoint, rate limit, network, overload.
const INFRA_RE = /upstream|unavailable|stream ended after|rate.?limit|too many requests|\b429\b|\b50[234]\b|overloaded|quota|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
process.setMaxListeners(0); // batch/bench run many jobs in one process, each with its own signal handlers
// Ctrl-C stops running jobs (per-job handlers) and tells batch/bench not to start new ones.
let interrupted = false;
export const isInterrupted = () => interrupted;
process.on("SIGINT", () => { interrupted = true; });
process.on("SIGTERM", () => { interrupted = true; });

class OcError extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}

// ---------- helpers ----------
const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);
const dur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${String(m).padStart(2, "0")}`) + `:${String(r).padStart(2, "0")}`;
};
const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
export const oneLine = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (x) => (x === null || x === undefined ? "  -" : `${Math.round(x * 100)}%`.padStart(4));
const short = (m) => String(m || "").replace(/^opencode\//, "");
const normRel = (p) => {
  const r = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return IS_WIN ? r.toLowerCase() : r;
};
const normAbs = (p) => normRel(path.resolve(p));

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) opt[key] = true;
      else { opt[key] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function opencodeBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (IS_WIN) {
    // Call the real exe, not the npm .cmd shim: cmd.exe would mangle a multi-line brief.
    const exe = path.join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "opencode";
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
}

function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch { /* a reader has it open; retry */ }
  }
  try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); } catch {}
}

// Cross-process mutex: mkdir is atomic. Stale locks (crashed holder) expire after 30s.
async function withLock(name, fn) {
  fs.mkdirSync(JOBS, { recursive: true });
  const dir = path.join(JOBS, `.${name}.lock`);
  for (;;) {
    try { fs.mkdirSync(dir); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (now() - fs.statSync(dir).mtimeMs > 30000) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      await sleep(80 + Math.random() * 150);
    }
  }
  try { return await fn(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------- model registry, stats, ranking ----------
export function loadModels() {
  const raw = readJSON(MODELS_FILE, {});
  if (raw.models) return raw;
  // v2 format was { "<model>": { result, seconds, tested, note } } from the smoke bench.
  const db = { version: 3, updated: null, models: {} };
  for (const [m, r] of Object.entries(raw)) {
    if (!r || typeof r !== "object") continue;
    db.models[m] = { note: r.note || "", bench: { smoke: { score: r.result === "pass" ? 1 : 0, seconds: r.seconds || 0, status: r.result, tested: r.tested } } };
  }
  return db;
}
export function saveModels(db) { writeJSON(MODELS_FILE, db); }
const loadStats = () => readJSON(STATS_FILE, { models: {} });

// A model id's prefix selects its runner and its tier. Anything else opencode knows
// (e.g. anthropic/... after `opencode auth login`) keeps using the opencode runner.
export function modelTier(id) {
  const s = String(id || "");
  // Antigravity's free quota is generous only for Gemini; its Claude / GPT-OSS models run out fast, so they count
  // as "paid": used only with --paid (or when named with --model).
  if (s.startsWith("antigravity/") && !s.startsWith("antigravity/gemini-")) return "paid";
  if (isPaidModel(s)) return "paid"; // the user's own API key (OpenAI, OpenRouter paid models, ...)
  return s.startsWith("claude/") || s.startsWith("codex/") ? "paid" : "free";
}
export function modelRunner(id) {
  const s = String(id || "");
  if (s.startsWith("ollama/")) return "ollama";
  if (s.startsWith("claude/")) return "claude";
  if (s.startsWith("codex/")) return "codex";
  if (s.startsWith("antigravity/")) return "antigravity";
  return "opencode";
}

function whichBin(name) {
  let r;
  try {
    r = IS_WIN
      ? spawnSync("where", [name], { encoding: "utf8", windowsHide: true, timeout: 5000 })
      : spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8", timeout: 5000 });
  } catch { return null; }
  const line = String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return r.status === 0 && line ? line : null;
}

// Synchronous JSON GET with a hard timeout (availableModels must stay sync for the dashboards).
function fetchJSONSync(url, timeoutMs) {
  const script = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(${Number(timeoutMs)})}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))`;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", windowsHide: true, timeout: Number(timeoutMs) + 1500 });
  if (r.status !== 0 || !r.stdout) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function ollamaModels() {
  const j = fetchJSONSync("http://127.0.0.1:11434/api/tags", 2000);
  const tags = Array.isArray(j?.models) ? j.models.map((m) => m?.name).filter(Boolean) : [];
  return tags.map((t) => `ollama/${t}`);
}

// Antigravity CLI (agy): Google's agent with Gemini, Claude and GPT-OSS models on the user's Antigravity account.
function agyBin() {
  const p = path.join(os.homedir(), ".gemini", "bin", IS_WIN ? "agy.exe" : "agy");
  return fs.existsSync(p) ? p : whichBin("agy");
}
function agyModels() {
  const bin = agyBin();
  if (!bin) return [];
  const res = spawnSync(bin, ["models"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 30000 });
  return (res.stdout || "").split(/\r?\n/).map((l) => l.split("\t")[0].trim())
    .filter((m) => /^[a-z0-9][a-z0-9.\-]+$/i.test(m) && !/^Fetching/i.test(m)).map((m) => "antigravity/" + m);
}
const AGY_NO_TERMINAL =
  "IMPORTANT: terminal commands are disabled in this session (run_command is always denied and ends your turn). " +
  "Do not run any command, not even to list files or run tests. Use only your file tools: list_dir, find_by_name, " +
  "grep_search, view_file / read_file, write_to_file, replace_file_content. The caller verifies and runs tests afterwards.\n\n";
function agyOnLine(ev, ctx) {
  const { job } = ctx;
  const k = ev.event, b = ev[k] || {};
  if (k === "init") { job.sessionId = job.sessionId || ev.conversation_id || null; return; }
  if (k === "step_update") {
    if (b.step_type === "agent_response") {
      if (b.state === "ACTIVE" && b.text_delta) job.lastActivity = "say: " + oneLine((job._agyText = (job._agyText || "") + b.text_delta), 80);
      if (b.state === "DONE") {
        job.steps++;
        const u = b.usage || {};
        ctx.addTokens(u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0), u.output_tokens || 0);
        if (job._agyText) { ctx.setText(job._agyText); job._agyText = ""; }
      }
    } else if (b.step_type === "tool" && b.state === "DONE") {
      const p = b.tool_info?.parameters || {};
      const target = p.Path || p.TargetFile || p.AbsolutePath || p.CommandLine || p.Command || "";
      if (/write|replace|edit|sed|notebook_edit/i.test(b.tool_name || "")) ctx.touch(target);
      ctx.toolEvent(b.tool_name, String(target), b.state === "ERROR");
    }
    return;
  }
  if (k === "result") {
    if (b.response) { job.lastText = String(b.response); job.lastActivity = "say: " + oneLine(b.response, 80); }
    if (b.status && b.status !== "SUCCESS") ctx.fail(b.error || b.response || `antigravity: ${b.status}`);
  }
}
function codexModels() {
  const dir = path.join(os.homedir(), ".codex");
  let file = path.join(dir, "models_cache.json");
  if (!fs.existsSync(file)) {
    try {
      const f = fs.readdirSync(dir).filter((x) => /\.json$/i.test(x) && /model/i.test(x)).map((x) => path.join(dir, x))[0];
      if (f) file = f;
    } catch { return []; }
  }
  const j = readJSON(file, null);
  const list = Array.isArray(j?.models) ? j.models : Array.isArray(j) ? j : [];
  return list.filter((m) => m && m.visibility === "list" && m.slug).map((m) => `codex/${m.slug}`);
}

let modelCache = null;
export function availableModels() {
  if (modelCache) return modelCache;
  const cacheFile = path.join(JOBS, ".models-cache.json");
  const cached = readJSON(cacheFile);
  // v2: the list now includes the ollama/claude/codex runners, so old caches are ignored once.
  if (cached?.v === 3 && now() - cached.at < 10 * 60 * 1000 && cached.models?.length) return (modelCache = cached.models);
  const res = spawnSync(opencodeBin(), ["models"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 60000 });
  const models = (res.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s.includes("/"));
  if (whichBin("claude")) models.push("claude/opus", "claude/haiku", "claude/sonnet");
  if (whichBin("codex")) models.push(...codexModels());
  models.push(...agyModels());
  models.push(...ollamaModels());
  const unique = [...new Set(models)];
  if (unique.length) { fs.mkdirSync(JOBS, { recursive: true }); writeJSON(cacheFile, { v: 3, at: now(), models: unique }); }
  return (modelCache = unique.length ? unique : [DEFAULT_MODEL]);
}

function modelScore(model, kind, db, stats) {
  const bench = db.models[model]?.bench || {};
  const tasks = KIND_TASKS[kind].filter((t) => bench[t]);
  let quality = tasks.length ? avg(tasks.map((t) => bench[t].score || 0)) : null;
  // Public benchmarks (models[id].research, gathered by Claude from SWE-bench / DeepSWE / Terminal-Bench reports):
  // our small bench saturates (many models score 100%), so research separates strong from adequate models.
  const research = db.models[model]?.research?.quality;
  if (typeof research === "number") quality = quality === null ? research : (quality + research) / 2;
  if (quality === null && !bench.smoke) quality = familyPrior(model);
  // Only a smoke result: weak signal. Passing ranks just above untested, failing (dead endpoint) drops out.
  if (quality === null && bench.smoke) quality = bench.smoke.score ? 0.4 : 0;
  const secs = tasks.length ? avg(tasks.map((t) => bench[t].seconds || 0)) : 300;
  const st = stats.models[model];
  const ks = st?.kinds?.[kind];
  const [good, bad] = ks && ks.good + ks.bad > 0 ? [ks.good, ks.bad] : [st?.good || 0, st?.bad || 0];
  const reliability = st?.jobs ? 1 - (0.7 * (st.infra || 0)) / st.jobs : 1;
  const prior = quality ?? 0.35; // untested: below models that passed the bench, above ones that failed it
  // Ratings update the bench estimate like extra observations (prior weight 2): good never lowers it, bad always does.
  const feedback = good + bad > 0 ? (good + 2 * prior) / (good + bad + 2) : null;
  let q = feedback ?? prior;
  if (model === DEFAULT_MODEL) q += 0.005; // tie-break toward the known-good default
  const score = q * reliability - (kind === "quick" ? secs / 2000 : secs / 20000);
  return { model, score, quality, feedback, reliability, secs, jobs: st?.jobs || 0, good, bad };
}

export function rankModels(kind) {
  if (!KIND_TASKS[kind]) throw new OcError(`unknown kind "${kind}" (use ${KINDS.join(", ")})`);
  const db = loadModels(), stats = loadStats();
  return availableModels().map((m) => modelScore(m, kind, db, stats)).sort((a, b) => b.score - a.score);
}

// A model whose endpoint just failed is skipped for a while instead of costing minutes per job.
const DEAD_MS = 30 * 60 * 1000;
// OpenCode's free tier is one quota for all its free models; when it runs out, skip them all for a while.
const QUOTA_RE = /Free usage limit reached|subscribe to OpenCode Go/i;
const QUOTA_DEAD_MS = 3 * 60 * 60 * 1000;
const isOpencodeQuota = (job) => /OpenCode free usage limit/i.test(job.error || "");
const isDead = (m, stats) => (stats.models[m]?.deadUntil || 0) > now();

// Codex runs on the ChatGPT plan (~OC_CODEX_MAX_5H messages per 5 h). Count recent codex jobs from job folders.
export const CODEX_MAX_5H = Number(process.env.OC_CODEX_MAX_5H || 8);
export function codexQuota() {
  const since = now() - 5 * 3600 * 1000;
  const used = allJobs().filter((j) => String(j.model || "").startsWith("codex/") && (j.startedAt || 0) >= since).length;
  return { used, max: CODEX_MAX_5H, blocked: used >= CODEX_MAX_5H, reason: "hết lượt Codex trong 5 giờ" };
}

// Claude runs on the Claude plan (~OC_CLAUDE_MAX_5H jobs per 5 h). Count recent claude jobs from job folders.
export const CLAUDE_MAX_5H = Number(process.env.OC_CLAUDE_MAX_5H || 6);
export function claudeQuota() {
  const since = now() - 5 * 3600 * 1000;
  const used = allJobs().filter((j) => String(j.model || "").startsWith("claude/") && (j.startedAt || 0) >= since).length;
  return { used, max: CLAUDE_MAX_5H, blocked: used >= CLAUDE_MAX_5H, reason: "hết lượt Claude trong 5 giờ" };
}

// Minimum required level per kind: hard >= 4, code >= 3, ui >= 3, quick >= 2
const KIND_MIN_LEVEL = { hard: 4, code: 3, ui: 3, quick: 2 };

// Ranked candidates for a kind, honouring the paid rule, codex quota, claude quota, and capability levels.
function rankedModels(kind, { allowPaid = false, excludeCodex = true, excludeClaude = true, minLevel } = {}) {
  const stats = loadStats();
  const quota = codexQuota();
  const cQuota = claudeQuota();
  return rankModels(kind).filter((r) => {
    if (!(r.quality === null || r.quality > 0) || isDead(r.model, stats)) return false;
    if (providerBlock(r.model)) return false;
    if (!allowPaid && modelTier(r.model) !== "free") return false;
    if (excludeCodex && quota.blocked && r.model.startsWith("codex/")) return false;
    if (excludeClaude && cQuota.blocked && r.model.startsWith("claude/")) return false;
    // Level filter: model must meet the minimum level (or --level override)
    const mdlLvl = modelLevel(r.model);
    const min = minLevel !== undefined ? minLevel : KIND_MIN_LEVEL[kind];
    if (mdlLvl < min) return false;
    return true;
  });
}

// Apply level-based ordering: hard = level first then score, others = score only
function applyLevelOrdering(results, kind, minLevel) {
  const min = minLevel !== undefined ? minLevel : KIND_MIN_LEVEL[kind];
  return results.sort((a, b) => {
    const alvl = modelLevel(a.model);
    const blvl = modelLevel(b.model);
    // For hard: order by level first, then score
    if (kind === "hard") {
      if (alvl !== blvl) return blvl - alvl; // higher level first
      return b.score - a.score;
    }
    // For other kinds: order by score among models meeting the minimum level
    // (they've already been filtered to meet min level, so just sort by score)
    return b.score - a.score;
  });
}

// True when a job may use paid models: --paid flag, batch "paid": true, or OC_URGENT=1.
const allowsPaid = (opts = {}) => !!(opts.paid || opts.tier === "paid" || process.env.OC_URGENT === "1");

function resolveChain({ model, kind, fallbacks, paid, level }) {
  const k = kind || "code";
  const n = Math.max(0, Number(fallbacks ?? DEFAULT_FALLBACKS));
  const allowPaid = allowsPaid({ paid });
  const stats = loadStats();
  const minLevel = level !== undefined ? level : undefined;
  const rows = rankedModels(k, { allowPaid, excludeCodex: true, minLevel: minLevel });
  const freeRows = rows.filter((r) => modelTier(r.model) === "free");
  const paidRows = rows.filter((r) => modelTier(r.model) === "paid");
  // Paid models are only ever fallbacks when the job allows them, and then after every free option.
  const rest = (allowPaid ? [...freeRows, ...paidRows] : freeRows).map((r) => r.model);
  if (model && model !== "auto") {
    const block = providerBlock(model);
    if (block) throw new OcError(`${model}: ${block}`, 2);
    const next = rest.filter((m) => m !== model).slice(0, n);
    if (isDead(model, stats) && next.length) {
      console.error(`oc: ${model} failed with an endpoint error in the last 30 min; using ${next[0]} (pass --fallbacks 0 to force it)`);
      return n === 0 ? [model] : next;
    }
    return [model, ...next];
  }
  const ordered = applyLevelOrdering(rows, k, minLevel);
  const chain = ordered.slice(0, n + 1).map((r) => r.model);
  return chain.length ? chain : [DEFAULT_MODEL];
}

// Choosing the first model of a new job (resolveChain is the pure ranking used for display):
// - spread: models within OC_SPREAD (3 points) of the best count as equal -> pick the one with fewest running jobs,
//   so parallel jobs do not all hit one free endpoint (rate limits);
// - explore: with probability OC_EXPLORE (15%), non-hard jobs go to a strong model (bench >= 90%) that has fewer than
//   5 real jobs, so the ranking learns from real work instead of rewarding only the current leader.
const SPREAD = Number(process.env.OC_SPREAD ?? 0.03);
const EXPLORE = Number(process.env.OC_EXPLORE ?? 0.15);
function pickChain({ model, kind, fallbacks, paid, level }) {
  const chain = resolveChain({ model, kind, fallbacks, paid, level });
  if (model && model !== "auto") return { chain, reason: "model chỉ định" };
  const k = kind || "code";
  const allowPaid = allowsPaid({ paid });
  const stats = loadStats();
  const ranked = rankedModels(k, { allowPaid, excludeCodex: true, minLevel: level !== undefined ? level : undefined });
  if (!ranked.length) return { chain, reason: "mặc định" };
  const running = {};
  for (const j of allJobs()) if (j.status === "running") running[j.model] = (running[j.model] || 0) + 1;
  const n = Math.max(0, Number(fallbacks ?? DEFAULT_FALLBACKS));
  
  const candidates = ranked.map((r) => r.model);
  const runningJobs = allJobs().filter((j) => j.status === "running");
  const headrooms = candidates.map((m) => modelHeadroom(runningJobs, m));
  const allFull = headrooms.every((h) => h === 0);
  
  let usable;
  let skipReason = "";
  
  if (allFull) {
    usable = [...ranked];
    skipReason = "";
  } else {
    usable = ranked.filter((r, i) => headrooms[i] > 0);
    const skipped = candidates.filter((m, i) => headrooms[i] === 0);
    if (skipped.length > 0) {
      skipReason = ` (bỏ qua ${skipped.map((m) => short(m)).join(", ")} hết slot)`;
    }
  }
  
  const top = usable[0];
  let first = top;
  let reason = `điểm cao nhất${skipReason}`;
  if (k !== "hard" && Math.random() < EXPLORE) {
    const pool = usable.slice(1, 5).filter((r) => (r.quality ?? 0) >= 0.9 && r.jobs < 5);
    if (pool.length) {
      first = pool[Math.floor(Math.random() * pool.length)];
      reason = `thử nghiệm: ${short(first.model)} mới có ${first.jobs} job thật (bench ${Math.round((first.quality ?? 0) * 100)}%)`;
    }
  }
  if (first === top) {
    const near = usable.filter((r) => top.score - r.score <= SPREAD);
    const best = [...near].sort((a, b) => (running[a.model] || 0) - (running[b.model] || 0) || b.score - a.score)[0];
    if (best && best.model !== top.model) {
      first = best;
      reason = `chia tải: ${short(top.model)} đang chạy ${running[top.model] || 0} job, ${short(best.model)} ngang điểm`;
    }
  }
  const rest = usable.map((r) => r.model).filter((m) => m !== first.model).slice(0, n);
  return { chain: [first.model, ...rest], reason };
}

async function recordStats(job) {
  // Money spent on the user's own API key counts even when the run was stopped or paused.
  if (providerOf(job.model)) addSpend(job.model, job.cost || 0);
  if (job.status === "stopped") return; // stopped by the user: says nothing about the model
  if (job.pausedMs > 0) return; // a paused run says nothing reliable about the model's speed or stability
  await withLock("stats", () => {
    const stats = loadStats();
    const s = (stats.models[job.model] ||= { jobs: 0, done: 0, failed: 0, infra: 0, secs: 0, good: 0, bad: 0, kinds: {} });
    s.jobs++;
    s.secs += Math.round(((job.endedAt || now()) - job.startedAt) / 1000);
    if (job.status === "done") { s.done++; delete s.deadUntil; }
    else if (isInfraFailure(job)) {
      s.infra++;
      if (INFRA_RE.test(job.error || "")) s.deadUntil = now() + DEAD_MS;
      if (isOpencodeQuota(job)) {
        for (const m of availableModels()) if (m.startsWith("opencode/")) (stats.models[m] ||= { jobs: 0, done: 0, failed: 0, infra: 0, secs: 0, good: 0, bad: 0, kinds: {} }).deadUntil = now() + QUOTA_DEAD_MS;
      }
    } else s.failed++;
    if (job.kind) {
      const k = (s.kinds[job.kind] ||= { jobs: 0, done: 0, good: 0, bad: 0 });
      k.jobs++;
      if (job.status === "done") k.done++;
    }
    writeJSON(STATS_FILE, stats);
  });
}

function isInfraFailure(job) {
  if (job.status === "done" || job.status === "stopped" || job.status === "blocked") return false;
  if (job.filesTouched?.length) return false; // it already edited files: retrying elsewhere could double-apply
  return INFRA_RE.test(job.error || "") || job.error === "silent done: model answered without doing the work" || job.status === "stalled" || job.status === "timeout" || job.steps <= 1;
}

// ---------- jobs ----------
export function allJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS)
    .filter((id) => !id.startsWith("."))
    .map((id) => readJSON(path.join(JOBS, id, "job.json")))
    .filter(Boolean)
    .map((j) => {
      // A runner that died without closing its job (machine sleep, killed shell) shows as "lost".
      if (j.status === "running" && !alive(j.runnerPid)) j.status = "lost";
      return j;
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

function findJob(ref) {
  const jobs = allJobs();
  if (!jobs.length) throw new OcError("no jobs yet");
  if (!ref || ref === "last") return jobs[0];
  const hits = jobs.filter((j) => j.id === ref || j.id.startsWith(ref) || j.name === ref);
  if (!hits.length) throw new OcError(`no job matches "${ref}"`);
  return hits[0];
}

// Files modified since `since` under `dir`. Catches edits made through shell commands (cat >, sed -i, codegen),
// which opencode's edit-tool events do not show. Skips dependency/build folders and dot-folders except .github.
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "__pycache__", "venv", "bower_components"]);
function changedSince(dir, since, limit = 80000) {
  const out = [];
  let seen = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || (e.name.startsWith(".") && e.name !== ".github")) continue;
        walk(p);
      } else if (e.isFile()) {
        if (/\.tsbuildinfo$|^next-env\.d\.ts$/.test(e.name)) continue; // written by tsc / next build, not by the model
        try { if (fs.statSync(p).mtimeMs > since) out.push(p); } catch {}
      }
    }
  };
  walk(dir);
  return out;
}

const inScopeOf = (rel, scopeNorm) => !scopeNorm?.length || scopeNorm.some((s) => rel === s || rel.startsWith(s + "/"));

function scopesOverlap(a, b) {
  if (!a.length || !b.length) return true; // no scope = whole directory
  return a.some((x) => b.some((y) => x === y || x.startsWith(y + "/") || y.startsWith(x + "/")));
}

function renderTool(part) {
  const tool = part.tool || "tool";
  const st = part.state || {};
  const inp = st.input || {};
  const target = inp.filePath || inp.path || inp.command || inp.pattern || inp.url || inp.description ||
    Object.values(inp).find((v) => typeof v === "string") || "";
  const shown = typeof target === "string" ? target.replace(/\\/g, "/") : "";
  const err = st.status === "error" ? `  !! ${oneLine(st.error || st.output, 200)}` : "";
  return `${tool.padEnd(6)} ${oneLine(shown, 140)}${err}`;
}

// Reserve a slot and create the job folder atomically, so parallel starters see each other.
async function reserveJob(o) {
  const deadline = now() + Number(o.waitTimeout || 3600) * 1000;
  let announced = false;
  let lastReason = "";
  for (;;) {
    const running = allJobs().filter((j) => j.status === "running");
    const can = canStart(running, o.model);
    
    const res = await withLock("slots", () => {
      if (!o.force) {
        const clash = running.find((j) => normAbs(j.dir) === normAbs(o.dir) && scopesOverlap(j.scopeNorm || [], o.scopeNorm));
        if (clash && !o.waitScope) throw new OcError(`scope overlaps running job ${clash.id} (${clash.name}). Give both jobs disjoint --scope, or wait.`, 3);
        if (clash || !can.ok) return null;
      }
      const d0 = new Date(), p2 = (n) => String(n).padStart(2, "0");
      const stamp = `${p2(d0.getMonth() + 1)}${p2(d0.getDate())}-${p2(d0.getHours())}${p2(d0.getMinutes())}`;
      const slug = o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "job";
      const id = `${stamp}-${slug}-${Math.random().toString(36).slice(2, 5)}`;
      const jd = path.join(JOBS, id);
      fs.mkdirSync(jd, { recursive: true });
      writeJSON(path.join(jd, "job.json"), { id, name: o.name, title: o.title, model: o.model, kind: o.kind, dir: o.dir, scopeNorm: o.scopeNorm, status: "running", runnerPid: process.pid, startedAt: now(), lastEventAt: now(), steps: 0, tokens: 0, filesTouched: [], lastActivity: "starting" });
      return { id, jd };
    });
    if (res) return res;
    if (o.wait === false) throw new OcError(`${can.reason}. Retry later or drop --no-wait.`, 3);
    if (now() > deadline) throw new OcError("gave up waiting for a free job slot", 3);
    if (!announced) {
      console.log(`${hhmmss(now())}  chờ slot: ${can.reason}`);
      announced = true;
      lastReason = can.reason;
    } else if (can.reason !== lastReason) {
      console.log(`${hhmmss(now())}  chờ slot: ${can.reason}`);
      lastReason = can.reason;
    }
    await sleep(3000);
  }
}

// ---------- runners ----------
// A runner is { cmd(o, message) -> { bin, args, env }, onLine(event, ctx) }. Everything else
// (job folder, log, events, watchdog, pause/stop, scope tracking, stats) is shared.
// ctx exposes: log, touch, job, setText, addTokens, toolEvent, fail.
function opencodeRunConfig(o) {
  const config = {
    permission: { external_directory: o.allowExternal ? { [String(o.allowExternal)]: "allow" } : "deny", question: "deny" },
  };
  if (modelRunner(o.model) === "ollama") {
    const tag = String(o.model).slice("ollama/".length);
    config.provider = { ollama: { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: process.env.OC_OLLAMA_BASEURL || "http://127.0.0.1:11434/v1" }, models: { [tag]: { name: tag, tool_call: true } } } };
    // Ollama's qwen3 models "think" by default, which can blow a job's timeout; turn it off for this provider.
    config.agent = { build: { request: { body: { think: false } } } };
  }
  return config;
}
function opencodeArgs(o, message) {
  const args = ["run", message, "--format", "json", "--dir", o.dir, "-m", o.model, "--title", o.title, "--print-logs", "--log-level", "WARN"];
  if (o.variant) args.push("--variant", o.variant);
  if (o.agent) args.push("--agent", o.agent);
  return args;
}
function opencodeEnv(o) {
  return { ...process.env, CI: "1", OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeRunConfig(o)) };
}
function opencodeOnLine(ev, ctx) {
  const { job } = ctx;
  const part = ev.part || {};
  job.sessionId = job.sessionId || ev.sessionID || null;
  switch (ev.type) {
    case "step_start":
      job.steps++;
      break;
    case "text":
      if (part.text) ctx.setText(part.text);
      break;
    case "tool_use": {
      const t = part.tool || "tool";
      job.tools[t] = (job.tools[t] || 0) + 1;
      if (part.state?.status === "error") {
        job.toolErrors++;
        const msg = String(part.state.error || part.state.output || "");
        // `opencode run` cannot show a permission prompt: an "ask" rule is auto-rejected and the session ends.
        if (/rejected permission/i.test(msg)) (job.blocked ||= []).push(oneLine(renderTool({ ...part, state: { ...part.state, status: "ok" } }), 120));
        else if (/rule which prevents/i.test(msg)) job.denied = (job.denied || 0) + 1;
      }
      if (EDIT_TOOLS.has(t)) ctx.touch(part.state?.input?.filePath || part.state?.input?.path);
      const r = renderTool(part);
      job.lastActivity = oneLine(r, 90);
      ctx.log(r);
      break;
    }
    case "step_finish": {
      const tk = part.tokens || {};
      ctx.addTokens(tk.total || 0, tk.output || 0);
      job.cost += part.cost || 0;
      break;
    }
    case "error": {
      const msg = ev.error?.data?.message || ev.error?.message || ev.error?.name || JSON.stringify(ev.error || ev).slice(0, 300);
      ctx.fail(msg);
      break;
    }
    default:
      break;
  }
}
const claudeBin = () => process.env.CLAUDE_BIN || whichBin("claude") || "claude";
const codexBin = () => process.env.CODEX_BIN || whichBin("codex") || "codex";
const CLAUDE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const toolTarget = (inp) => inp.file_path || inp.command || inp.path || inp.pattern || inp.url || inp.description ||
  Object.values(inp).find((v) => typeof v === "string") || "";
function claudeOnLine(ev, ctx) {
  const { job } = ctx;
  if (ev.type === "system") {
    if (ev.session_id) job.sessionId = job.sessionId || ev.session_id;
    return;
  }
  if (ev.type === "assistant") {
    for (const item of ev.message?.content || []) {
      if (item.type === "text") ctx.setText(item.text);
      else if (item.type === "tool_use") {
        const inp = item.input || {};
        if (CLAUDE_EDIT_TOOLS.has(item.name)) ctx.touch(inp.file_path || inp.path);
        ctx.toolEvent(item.name, String(toolTarget(inp)), false);
      }
    }
    return;
  }
  if (ev.type === "user") {
    for (const item of ev.message?.content || []) {
      if (item.type === "tool_result" && item.is_error) {
        job.toolErrors++;
        const text = typeof item.content === "string" ? item.content : JSON.stringify(item.content || "");
        ctx.log(`WARN  tool result error: ${oneLine(text, 200)}`);
      }
    }
    return;
  }
  if (ev.type === "result") {
    const u = ev.usage || {};
    const total = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0);
    ctx.addTokens(total, u.output_tokens || 0);
    if (typeof ev.total_cost_usd === "number") job.cost += ev.total_cost_usd;
    if (ev.result) { job.lastText = String(ev.result); job.lastActivity = "say: " + oneLine(ev.result, 80); }
    if (ev.is_error || String(ev.subtype || "").startsWith("error")) ctx.fail(ev.result || ev.subtype || "claude reported an error");
  }
}
function codexOnLine(ev, ctx) {
  const { job } = ctx;
  const t = ev.type;
  if (t === "thread.started") {
    if (ev.thread_id) job.sessionId = job.sessionId || ev.thread_id;
    return;
  }
  if (t === "item.started" || t === "item.completed") {
    const it = ev.item || {};
    const done = t === "item.completed";
    if (it.type === "agent_message") {
      if (done && it.text) ctx.setText(it.text);
    } else if (it.type === "command_execution") {
      if (done) ctx.toolEvent("bash", String(it.command || ""), Number(it.exit_code) !== 0);
    } else if (it.type === "file_change") {
      if (done) {
        const paths = Array.isArray(it.changes) ? it.changes.map((c) => c?.path).filter(Boolean) : [];
        if (it.path) paths.push(it.path);
        for (const p of paths) ctx.touch(p);
        ctx.toolEvent("edit", paths.join(", ") || "(file_change)", it.status === "failed");
      }
    }
    return;
  }
  if (t === "turn.completed") {
    const u = ev.usage || {};
    const total = (u.input_tokens || 0) + (u.cached_input_tokens || 0) + (u.output_tokens || 0);
    ctx.addTokens(total, u.output_tokens || 0);
    return;
  }
  if (t === "turn.failed") {
    const msg = ev.error?.message || ev.error || "codex turn failed";
    ctx.fail(typeof msg === "string" ? msg : JSON.stringify(msg));
    return;
  }
  if (t === "error") {
    const msg = ev.message || ev.error?.message || "codex error";
    if (/Model metadata .* not found/i.test(msg)) { ctx.log(`WARN  ${oneLine(msg, 200)} (ignored)`); return; }
    ctx.fail(msg);
  }
}
const RUNNERS = {
  opencode: { cmd: (o, message) => ({ bin: opencodeBin(), args: opencodeArgs(o, message), env: opencodeEnv(o) }), onLine: opencodeOnLine },
  ollama: { cmd: (o, message) => ({ bin: opencodeBin(), args: opencodeArgs(o, message), env: opencodeEnv(o) }), onLine: opencodeOnLine },
  claude: {
    cmd: (o, message) => ({
      bin: claudeBin(),
      args: ["-p", message, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--model", String(o.model).slice("claude/".length)],
      env: { ...process.env, CI: "1" },
    }),
    onLine: claudeOnLine,
  },
  codex: {
    cmd: (o, message) => ({
      bin: codexBin(),
      args: ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write", "-m", String(o.model).slice("codex/".length), "-C", o.dir, message],
      env: { ...process.env, CI: "1" },
    }),
    onLine: codexOnLine,
  },
  antigravity: {
    // Print mode, auto-accept edits; the agent works in the job folder (cwd). Headless agy auto-denies every terminal
    // command and then ends the turn, so the agent is told up front to work with its file tools only.
    cmd: (o, message) => ({
      bin: agyBin(),
      args: ["-p", AGY_NO_TERMINAL + message, "--output-format", "stream-json", "--mode", "accept-edits", "--model", String(o.model).slice("antigravity/".length)],
      env: { ...process.env, CI: "1" },
    }),
    onLine: agyOnLine,
  },
};

// One attempt with one model. Resolves with the final job state.
async function runAttempt(o) {
  const { id, jd } = await reserveJob(o);
  return new Promise((resolve) => {
    const scratch = `.oc-tmp/${id}`;
    const rules = [
      "",
      "---",
      "Controller rules for this run:",
      "- Your shell already starts in the project root. Use relative paths only; never `cd` to an absolute path.",
      "- Everything outside the project folder is blocked (including /tmp and the OS temp folder). For scratch files use " +
        `\`${scratch}/\` (it is deleted after the run).`,
      o.scopeList.length ? `- Only create or edit these paths: ${o.scopeList.join(", ")}.` : "- Only edit files the brief is about.",
      "- Never stage, record, publish or rewrite version-control history. The user does that.",
      "- Run tests/builds in single-run mode (no watch mode, no dev servers, nothing that waits for input).",
      "- Do not ask questions. If something is ambiguous, choose the safest option and say so in the summary.",
      "- Run the acceptance checks from the brief yourself and fix failures before finishing.",
      "- Finish with a short summary: files changed, commands run with their results, anything left undone.",
    ].join("\n");
    const message = o.text + "\n" + rules;
    fs.writeFileSync(path.join(jd, "brief.md"), message);

    const job = {
      id, name: o.name, title: o.title, model: o.model, kind: o.kind || null, variant: o.variant || null, agent: o.agent || null,
      attempt: o.attempt, chain: o.chain, dir: o.dir, scope: o.scopeList, scopeNorm: o.scopeNorm, brief: path.resolve(o.brief),
      batch: o.batch || null, batchJob: o.batchJob || null, paused: false, pausedMs: 0,
      pickReason: o.attempt > 1 ? `dự phòng sau ${short(o.prev?.model)}` : o.pickReason || null,
      status: "running", exitCode: null, runnerPid: process.pid, pid: null,
      startedAt: now(), endedAt: null, lastEventAt: now(),
      steps: 0, tokens: 0, outputTokens: 0, cost: 0, tools: {}, toolErrors: 0,
      filesTouched: [], outOfScope: [], lastText: "", lastActivity: "starting", error: null,
      sessionId: null, rating: null,
    };
    const jobFile = path.join(jd, "job.json");
    const logFile = path.join(jd, "job.log");
    writeJSON(jobFile, job);
    const log = (line) => {
      const l = `${hhmmss(now())}  ${line}`;
      fs.appendFileSync(logFile, l + "\n");
      if (!o.quiet) console.log(l);
    };
    if (o.prev) log(`RETRY attempt ${o.attempt}/${o.chain.length}: ${short(o.prev.model)} failed before editing (${oneLine(o.prev.error || o.prev.status, 120)})`);
    log(`START ${o.title}  model=${o.model}${o.kind ? " kind=" + o.kind : ""}${o.variant ? " variant=" + o.variant : ""}  dir=${o.dir}${o.scopeList.length ? "  scope=" + o.scopeList.join(",") : ""}`);

    // Local Ollama models need the server up start-to-finish; otherwise fail fast so runJob can fall back.
    if (modelRunner(o.model) === "ollama" && !fetchJSONSync("http://127.0.0.1:11434/api/tags", 2000)) {
      job.error = "Ollama server is not running (start: ollama serve)";
      job.endedAt = now();
      job.status = "failed";
      log(`ERROR ${job.error}`);
      log(`END   ${job.status}  exit=null  ${dur(0)}  steps=0  tokens=0  files=0`);
      writeJSON(jobFile, job);
      resolve(job);
      return;
    }

    const runner = RUNNERS[modelRunner(o.model)] || RUNNERS.opencode;
    const { bin, args, env } = runner.cmd(o, message);
    // stdin MUST be closed: with an open stdin pipe the runner waits for input forever.
    const child = spawn(bin, args, { cwd: o.dir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN });
    job.pid = child.pid;

    const events = fs.createWriteStream(path.join(jd, "events.jsonl"));
    const debug = fs.createWriteStream(path.join(jd, "debug.log"));
    child.stderr.pipe(debug);
    let quotaHit = false;
    child.stderr.on("data", (chunk) => {
      if (quotaHit || !QUOTA_RE.test(String(chunk))) return;
      quotaHit = true;
      job.error = "quota: OpenCode free usage limit reached (all opencode free models share it)";
      log(`ERROR ${job.error}`);
      killTree(child.pid);
    });

    let dirty = true;
    const flushTimer = setInterval(() => { if (dirty) { writeJSON(jobFile, job); dirty = false; } }, 1000);

    const touch = (file) => {
      if (!file) return;
      const rel = normRel(path.relative(o.dir, path.resolve(o.dir, file)));
      if (rel.startsWith(".oc-tmp/")) return; // the job's own scratch folder, deleted after the run
      if (!job.filesTouched.includes(rel)) job.filesTouched.push(rel);
      const inScope = !o.scopeNorm.length || o.scopeNorm.some((s) => rel === s || rel.startsWith(s + "/"));
      if (!inScope && !job.outOfScope.includes(rel)) {
        job.outOfScope.push(rel);
        log(`WARN  edited outside scope: ${rel}`);
      }
    };

    // Shared per-run context handed to the runner's event parser.
    const ctx = {
      log, touch, job,
      setText(text) {
        if (!text) return;
        job.lastText = String(text);
        job.lastActivity = "say: " + oneLine(text, 80);
        log(`say   ${oneLine(text, 300)}`);
      },
      addTokens(total, output) {
        job.tokens += total || 0;
        job.outputTokens += output || 0;
      },
      toolEvent(tool, target, isError) {
        const t = tool || "tool";
        job.tools[t] = (job.tools[t] || 0) + 1;
        if (isError) job.toolErrors++;
        const shown = String(target ?? "").replace(/\\/g, "/");
        job.lastActivity = oneLine(`${t} ${shown}`, 90);
        log(`${t.padEnd(6)} ${oneLine(shown, 140)}${isError ? "  !!" : ""}`);
      },
      fail(message) {
        const msg = String(message || "error");
        job.error = msg;
        log(`ERROR ${oneLine(msg, 300)}`);
      },
    };

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      events.write(line + "\n");
      let ev;
      try { ev = JSON.parse(line); } catch { log(`raw   ${oneLine(line, 200)}`); return; }
      job.lastEventAt = now();
      dirty = true;
      runner.onLine(ev, ctx);
    });

    let killedFor = null;
    let pausedSince = null;
    const watchdog = setInterval(() => {
      const t = now();
      // `oc pause` writes pause.flag and suspends the process tree: the clocks must not run while it is frozen.
      if (fs.existsSync(path.join(jd, "pause.flag"))) {
        if (!pausedSince) { pausedSince = t; job.paused = true; job.lastActivity = "tạm dừng"; dirty = true; log("PAUSE job suspended"); }
        return;
      }
      if (pausedSince) {
        const d = t - pausedSince;
        job.pausedMs += d; job.lastEventAt += d; job.paused = false; pausedSince = null; dirty = true;
        log(`RESUME after ${dur(d)}`);
      }
      if (o.timeout && t - job.startedAt - job.pausedMs > o.timeout * 1000) { killedFor = "timeout"; killTree(child.pid); }
      else if (job.steps === 0 && now() - job.startedAt > 150 * 1000) { killedFor = "stalled"; killTree(child.pid); }
      else if (o.stall && t - job.lastEventAt > o.stall * 1000) { killedFor = "stalled"; killTree(child.pid); }
    }, 2000);

    const onSignal = () => { killedFor = "stopped"; killTree(child.pid); };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    child.on("error", (e) => { job.error = `spawn failed: ${e.message}`; log(`ERROR ${job.error}`); });
    child.on("close", (code) => {
      clearInterval(watchdog);
      clearInterval(flushTimer);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      events.end();
      debug.end();
      // `oc stop` (another process) leaves a marker file before killing the job.
      if (fs.existsSync(path.join(jd, "stop.flag"))) killedFor = "stopped";
      if (!job.error && code !== 0) {
        // opencode sometimes reports provider errors only on stderr.
        try {
          const tail = fs.readFileSync(path.join(jd, "debug.log"), "utf8").split(/\r?\n/).filter((l) => /error/i.test(l)).slice(-1)[0];
          if (tail) job.error = oneLine(tail.replace(/\x1b\[[0-9;]*m/g, ""), 300);
        } catch {}
      }
      job.exitCode = code;
      job.endedAt = now();
      // Scratch folder for this job only; drop .oc-tmp itself when no other job uses it.
      try {
        fs.rmSync(path.join(o.dir, scratch), { recursive: true, force: true });
        const tmpRoot = path.join(o.dir, ".oc-tmp");
        if (fs.existsSync(tmpRoot) && !fs.readdirSync(tmpRoot).length) fs.rmdirSync(tmpRoot);
      } catch {}
      // Real changes on disk, attributed to this job unless they fall inside a job that overlapped in time.
      try {
        const peers = allJobs().filter((j) => j.id !== job.id && normAbs(j.dir) === normAbs(o.dir) &&
          j.startedAt <= job.endedAt && (j.endedAt || now()) >= job.startedAt);
        let otherChanged = [];
        for (const f of changedSince(o.dir, job.startedAt)) {
          const rel = normRel(path.relative(o.dir, f));
          // Always ignore these files.
          if (rel === "stats.json" || rel === "models.json" || rel.startsWith(".batches/") || rel.startsWith(".oc-tmp/")) continue;
          // Files from this job's own tool events are already recorded via touch().
          // Do not add them to outOfScope again from this scan.
          if (job.filesTouched.includes(rel)) continue;
          // Files changed by another process: collect for INFO log.
          if (!peers.some((p) => inScopeOf(rel, p.scopeNorm))) {
            otherChanged.push(rel);
          }
        }
        if (otherChanged.length) {
          log(`INFO changed by another process: ${otherChanged.join(", ")}`);
        }
      } catch (e) { log(`WARN  change scan failed: ${e.message}`); }
      // Silent done: process exited 0 but changed no files and lastText is empty or looks like a raw tool call.
      if (code === 0 && !job.error && job.filesTouched.length === 0) {
        const lastTextIsRaw =
          !job.lastText ||
          String(job.lastText).startsWith("{") ||
          String(job.lastText).startsWith("<?xml") ||
          String(job.lastText).includes('"filePath"') ||
          String(job.lastText).includes("<function>");
        if (lastTextIsRaw) {
          job.error = "silent done: model answered without doing the work";
        }
      }
      if (job.pausedMs > 0 && !killedFor && !job.error && job.filesTouched.length === 0 && job.steps <= 2) {
        job.error = "model stream ended after the job was paused (no work done) - retrying is safe";
      }
      if (job.blocked?.length && !job.error) job.error = `permission auto-rejected (opencode run cannot ask): ${job.blocked.join("; ")}`;
      job.status = killedFor || (job.blocked?.length ? "blocked" : code === 0 && !job.error ? "done" : "failed");
      log(`END   ${job.status}  exit=${code}  ${dur(job.endedAt - job.startedAt)}  steps=${job.steps}  tokens=${kfmt(job.tokens)}  files=${job.filesTouched.length}`);
      writeJSON(jobFile, job);
      resolve(job);
    });
  });
}

// Runs a job, falling back to the next ranked model when a model fails for infrastructure
// reasons before editing anything. Resolves with the final attempt's job state.
export async function runJob(opts) {
  if (!fs.existsSync(opts.brief)) throw new OcError(`brief not found: ${opts.brief}`);
  const dir = path.resolve(opts.dir || process.cwd());
  if (!fs.existsSync(dir)) throw new OcError(`dir not found: ${dir}`);
  const text = fs.readFileSync(opts.brief, "utf8");
  if (text.length > 27000) throw new OcError("brief too long for one command line (>27k chars). Split it into smaller briefs.");
  const title = oneLine(text.split(/\r?\n/).find((l) => l.trim()) || "opencode job", 70).replace(/^#+\s*/, "");
  const scopeList = (opts.scope ? String(opts.scope).split(",") : []).map((s) => s.trim()).filter(Boolean);
  const kind = opts.kind && opts.kind !== true ? String(opts.kind) : null;
  if (kind && !KIND_TASKS[kind]) throw new OcError(`unknown kind "${kind}" (use ${KINDS.join(", ")})`);
  const { chain, reason: pickReason } = pickChain({ model: opts.model, kind, fallbacks: opts.fallbacks, paid: allowsPaid(opts), level: opts.level });
  const base = {
    ...opts, dir, text, title, kind, chain, pickReason, scopeList, scopeNorm: scopeList.map(normRel),
    name: opts.name || title, timeout: Number(opts.timeout || 900), stall: Number(opts.stall || 300),
  };
  const attempts = [];
  let job = null;
  for (let i = 0; i < chain.length; i++) {
    job = await runAttempt({ ...base, model: chain[i], attempt: i + 1, prev: job });
    attempts.push({ id: job.id, model: job.model, status: job.status, error: job.error ? oneLine(job.error, 160) : null });
    if (!opts.noStats) await recordStats(job);
    if (job.status === "done" || !isInfraFailure(job)) break;
    if (isOpencodeQuota(job)) {
      // The shared free quota is gone: drop the other opencode models and, if nothing else is left, re-rank
      // without them (they are marked dead now) so the job still runs on another runner.
      let rest = chain.slice(i + 1).filter((m) => !m.startsWith("opencode/"));
      if (!rest.length) {
        rest = resolveChain({ kind, fallbacks: Math.max(2, Number(opts.fallbacks ?? DEFAULT_FALLBACKS)), paid: allowsPaid(opts), level: opts.level })
          .filter((m) => !m.startsWith("opencode/") && !chain.includes(m));
      }
      chain.splice(i + 1, chain.length, ...rest);
    }
    if (i === chain.length - 1) break;
  }
  job.attempts = attempts;
  writeJSON(path.join(JOBS, job.id, "job.json"), job);
  return job;
}

function report(job) {
  const lines = [];
  const end = job.endedAt || now();
  lines.push(`job      ${job.id}  (${job.name})`);
  lines.push(`status   ${job.status}${job.exitCode !== null && job.exitCode !== undefined ? "  exit=" + job.exitCode : ""}  ${dur(end - job.startedAt)}`);
  lines.push(`model    ${job.model}${job.kind ? "  kind=" + job.kind : ""}${job.variant ? "  variant=" + job.variant : ""}`);
  if (job.pickReason) lines.push(`picked   ${job.pickReason}`);
  if (job.attempts?.length > 1) lines.push(`attempts ${job.attempts.map((a) => `${short(a.model)}:${a.status}`).join(" -> ")}`);
  lines.push(`dir      ${job.dir}`);
  if (job.scope?.length) lines.push(`scope    ${job.scope.join(", ")}`);
  lines.push(`usage    steps=${job.steps}  tokens=${kfmt(job.tokens)}  out=${kfmt(job.outputTokens)}  cost=$${(job.cost || 0).toFixed(4)}`);
  lines.push(`tools    ${Object.entries(job.tools || {}).map(([k, v]) => `${k}x${v}`).join(" ") || "-"}${job.toolErrors ? `  (errors: ${job.toolErrors})` : ""}`);
  lines.push(`files    ${job.filesTouched?.length ? job.filesTouched.join(", ") : "(none recorded)"}`);
  if (job.outOfScope?.length) lines.push(`WARNING  outside scope: ${job.outOfScope.join(", ")}`);
  if (job.error) lines.push(`error    ${oneLine(job.error, 400)}`);
  if (job.status === "blocked") lines.push("fix      allow that action in the project's opencode.json \"permission\" block (never with --auto), or change the brief so it is not needed");
  if (job.denied) lines.push(`denied   ${job.denied} tool call(s) refused by permission rules (outside-project paths, version-control publishing); the run continued`);
  if (job.rating) lines.push(`rating   ${job.rating}${job.ratingNote ? " - " + job.ratingNote : ""}`);
  lines.push(`log      ${path.join(JOBS, job.id, "job.log")}`);
  lines.push(`next     verify, then: oc rate ${job.id} good|bad`);
  lines.push("--- last message from opencode ---");
  lines.push(String(job.lastText || "(none)").trim().slice(-2000));
  return lines.join("\n");
}

// ---------- actions shared by the CLI and the dashboards ----------
// Record Claude's (or the user's) verdict on a finished job; feeds the model ranking. Re-rating replaces the old verdict.
export async function rateJob(ref, verdict, note = "") {
  if (!["good", "bad"].includes(verdict)) throw new OcError("usage: oc rate <id> good|bad [--note text]");
  const j = findJob(ref);
  const file = path.join(JOBS, j.id, "job.json");
  const prevRating = j.rating;
  writeJSON(file, { ...readJSON(file, j), rating: verdict, ratingNote: note || "" });
  await withLock("stats", () => {
    const stats = loadStats();
    const s = (stats.models[j.model] ||= { jobs: 0, done: 0, failed: 0, infra: 0, secs: 0, good: 0, bad: 0, kinds: {} });
    const k = j.kind ? (s.kinds[j.kind] ||= { jobs: 0, done: 0, good: 0, bad: 0 }) : null;
    if (prevRating) { s[prevRating] = Math.max(0, s[prevRating] - 1); if (k) k[prevRating] = Math.max(0, k[prevRating] - 1); }
    s[verdict]++;
    if (k) k[verdict]++;
    writeJSON(STATS_FILE, stats);
  });
  return { ...j, rating: verdict };
}

// Stop a running job ("lost" = all jobs whose controller died; their opencode child may still run). Returns messages.
export function stopJob(ref) {
  if (ref === "lost") {
    const targets = allJobs().filter((j) => j.status === "lost");
    const out = [];
    for (const j of targets) {
      if (j.status !== "running" && j.status !== "lost") { out.push(`${j.id} is ${j.status}`); continue; }
      fs.writeFileSync(path.join(JOBS, j.id, "stop.flag"), String(now()));
      killTree(j.pid);
      if (j.status === "lost") {
        const file = path.join(JOBS, j.id, "job.json");
        writeJSON(file, { ...readJSON(file, j), status: "stopped", endedAt: now() });
      }
      out.push(`stopped ${j.id}`);
    }
    return out;
  }
  if (!ref || ref.trim() === "") throw new OcError("cần id job");
  let targets;
  try {
    targets = [findJob(ref)];
  } catch (e) {
    if (e instanceof OcError) throw new OcError("cần id job");
    throw e;
  }
  const out = [];
  for (const j of targets) {
    if (j.status !== "running" && j.status !== "lost") { out.push(`${j.id} is ${j.status}`); continue; }
    fs.writeFileSync(path.join(JOBS, j.id, "stop.flag"), String(now()));
    killTree(j.pid);
    if (j.status === "lost") {
      const file = path.join(JOBS, j.id, "job.json");
      writeJSON(file, { ...readJSON(file, j), status: "stopped", endedAt: now() });
    }
    out.push(`stopped ${j.id}`);
  }
  return out;
}

// Freeze / thaw a process and all its descendants (Windows: NtSuspendProcess via an inline PowerShell P/Invoke).
function setTreeSuspended(pid, suspend) {
  if (!pid) return false;
  if (!IS_WIN) {
    try { process.kill(-pid, suspend ? "SIGSTOP" : "SIGCONT"); return true; } catch { try { process.kill(pid, suspend ? "SIGSTOP" : "SIGCONT"); return true; } catch { return false; } }
  }
  const fn = suspend ? "NtSuspendProcess" : "NtResumeProcess";
  const ps = [
    "$src = 'using System; using System.Runtime.InteropServices; public static class OcNt {",
    " [DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr h);",
    " [DllImport(\"ntdll.dll\")] public static extern int NtResumeProcess(IntPtr h);",
    " [DllImport(\"kernel32.dll\")] public static extern IntPtr OpenProcess(int a, bool i, int p);",
    " [DllImport(\"kernel32.dll\")] public static extern bool CloseHandle(IntPtr h); }';",
    "Add-Type -TypeDefinition $src;",
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId);",
    `$ids = New-Object System.Collections.Generic.List[int]; $ids.Add(${Number(pid)});`,
    "for ($i = 0; $i -lt $ids.Count; $i++) { foreach ($p in $all) { if ($p.ParentProcessId -eq $ids[$i]) { $ids.Add([int]$p.ProcessId) } } }",
    `$n = 0; foreach ($id in $ids) { $h = [OcNt]::OpenProcess(0x0800, $false, $id); if ($h -ne [IntPtr]::Zero) { [void][OcNt]::${fn}($h); [void][OcNt]::CloseHandle($h); $n++ } }`,
    "Write-Output $n",
  ].join(" ");
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
  return r.status === 0 && Number(String(r.stdout).trim()) > 0;
}

// Pause a running job: the controller stops its timeout/stall clocks and the opencode process tree is frozen.
export function pauseJob(ref) {
  const j = findJob(ref);
  if (j.status !== "running") throw new OcError(`${j.id} is ${j.status}, only running jobs can be paused`);
  const flag = path.join(JOBS, j.id, "pause.flag");
  if (fs.existsSync(flag)) return `${j.id} is already paused`;
  fs.writeFileSync(flag, String(now()));
  const ok = setTreeSuspended(j.pid, true);
  return ok ? `paused ${j.id}` : `paused ${j.id} (clocks stopped; could not freeze the process)`;
}

export function resumeJob(ref) {
  const j = findJob(ref);
  const flag = path.join(JOBS, j.id, "pause.flag");
  if (!fs.existsSync(flag)) return `${j.id} is not paused`;
  setTreeSuspended(j.pid, false);
  fs.rmSync(flag, { force: true });
  return `resumed ${j.id}`;
}

// Pause a batch: running jobs continue, no new job starts until it is resumed.
function batchFlag(ref) {
  const b = ref === "last" || !ref ? allBatches()[0] : allBatches().find((x) => x.id === ref || x.id.startsWith(ref) || x.name === ref);
  if (!b) throw new OcError(`no batch matches "${ref}"`);
  return { b, flag: path.join(JOBS, ".batches", `${b.id}.pause`) };
}
export function pauseBatch(ref) {
  const { b, flag } = batchFlag(ref);
  if (b.status !== "running" && b.status !== "paused") throw new OcError(`batch ${b.id} is ${b.status}`);
  fs.writeFileSync(flag, String(now()));
  return `paused batch ${b.id} (running jobs continue, no new job starts)`;
}
export function resumeBatch(ref) {
  const { b, flag } = batchFlag(ref);
  fs.rmSync(flag, { force: true });
  return `resumed batch ${b.id}`;
}

export function allBatches() {
  const dir = path.join(JOBS, ".batches");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => readJSON(path.join(dir, f)))
    .filter(Boolean)
    .map((b) => (b.status === "running" && !alive(b.runnerPid) ? { ...b, status: "lost" } : b))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export { JOBS, findJob, OcError, pickChain };

// ---------- batch ----------
async function runBatch(planFile, opt) {
  const plan = readJSON(planFile);
  if (!plan || !Array.isArray(plan.jobs)) throw new OcError(`cannot read plan (needs {"jobs": [...]}): ${planFile}`);
  const base = path.dirname(path.resolve(planFile));
  const defaults = plan.defaults || {};
  const jobs = plan.jobs.map((j) => ({ ...defaults, ...j, after: j.after || [] }));
  const names = new Set();
  for (const j of jobs) {
    if (!j.name || !j.brief) throw new OcError(`every job needs "name" and "brief": ${JSON.stringify(j)}`);
    if (names.has(j.name)) throw new OcError(`duplicate job name: ${j.name}`);
    names.add(j.name);
  }
  for (const j of jobs) for (const d of j.after) if (!names.has(d)) throw new OcError(`${j.name}: unknown dependency "${d}"`);
  // Waves = topological levels; also detects cycles.
  const level = {};
  const visit = (n, stack = []) => {
    if (level[n] !== undefined) return level[n];
    if (stack.includes(n)) throw new OcError(`dependency cycle: ${[...stack, n].join(" -> ")}`);
    const j = jobs.find((x) => x.name === n);
    level[n] = j.after.length ? 1 + Math.max(...j.after.map((d) => visit(d, [...stack, n]))) : 0;
    return level[n];
  };
  jobs.forEach((j) => visit(j.name));
  const waves = [];
  for (const j of jobs) (waves[level[j.name]] ||= []).push(j.name);
  console.log(`batch ${path.basename(planFile)}: ${jobs.length} jobs in ${waves.length} waves`);
  waves.forEach((w, i) => console.log(`  wave ${i + 1}: ${w.join(", ")}`));
  if (opt["dry-run"]) {
    for (const j of jobs) console.log(`  ${j.name}: kind=${j.kind || "code"} model=${j.model || "auto"} -> ${resolveChain({ model: j.model, kind: j.kind, fallbacks: j.fallbacks, paid: allowsPaid(j), level: Number(opt.level || 0) }).map(short).join(" > ")}`);
    return 0;
  }

  const state = Object.fromEntries(jobs.map((j) => [j.name, "pending"]));
  const results = {};
  const t0 = now();
  // Batch record for dashboards: <jobs>/.batches/<id>.json (jobs link back via job.batch / job.batchJob).
  const d0 = new Date(t0), p2 = (n) => String(n).padStart(2, "0");
  const planName = path.basename(planFile).replace(/\.json$/i, "");
  const batchId = `${p2(d0.getMonth() + 1)}${p2(d0.getDate())}-${p2(d0.getHours())}${p2(d0.getMinutes())}-${planName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`;
  const batchDir = path.join(JOBS, ".batches");
  fs.mkdirSync(batchDir, { recursive: true });
  const isPaused = () => fs.existsSync(path.join(batchDir, `${batchId}.pause`));
  const saveBatch = (status) => writeJSON(path.join(batchDir, `${batchId}.json`), {
    id: batchId, name: planName, plan: path.resolve(planFile), dir: path.resolve(base, plan.dir || "."),
    status: status === "running" && isPaused() ? "paused" : status, runnerPid: process.pid, startedAt: t0, endedAt: status === "running" ? null : now(), waves,
    jobs: jobs.map((j) => ({ name: j.name, kind: j.kind || "code", after: j.after, scope: j.scope || "",
      state: state[j.name], jobId: results[j.name]?.id || null, model: results[j.name]?.model || null })),
  });
  saveBatch("running");
  await new Promise((resolve) => {
    const tick = () => {
      saveBatch("running");
      let changed = true;
      while (changed) {
        changed = false;
        for (const j of jobs) {
          if (state[j.name] !== "pending") continue;
          if (interrupted || j.after.some((d) => state[d] === "failed" || state[d] === "skipped")) {
            state[j.name] = "skipped";
            console.log(`${hhmmss(now())}  SKIP  ${j.name} (a dependency did not finish)`);
            changed = true;
          } else if (!isPaused() && j.after.every((d) => state[d] === "done")) {
            state[j.name] = "running";
            console.log(`${hhmmss(now())}  START ${j.name}`);
            runJob({
              ...j, brief: path.resolve(base, j.brief), dir: path.resolve(base, j.dir || plan.dir || "."),
              quiet: true, waitScope: true, batch: batchId, batchJob: j.name,
            }).then((job) => {
              results[j.name] = job;
              state[j.name] = job.status === "done" ? "done" : "failed";
              console.log(`${hhmmss(now())}  ${state[j.name] === "done" ? "DONE " : "FAIL "} ${j.name}  ${short(job.model)}  ${dur(job.endedAt - job.startedAt)}  files=${job.filesTouched.length}${job.outOfScope?.length ? "  !scope" : ""}${job.error ? "  " + oneLine(job.error, 100) : ""}`);
              tick();
            }).catch((e) => {
              results[j.name] = { status: "failed", error: e.message };
              state[j.name] = "failed";
              console.log(`${hhmmss(now())}  FAIL  ${j.name}  ${e.message}`);
              tick();
            });
          }
        }
      }
      if (Object.values(state).every((s) => s !== "pending" && s !== "running")) { clearInterval(heartbeat); resolve(); }
    };
    // Re-check every 3 s so a paused batch continues as soon as it is resumed (and the record stays fresh).
    const heartbeat = setInterval(tick, 3000);
    tick();
  });
  saveBatch(interrupted ? "stopped" : Object.values(state).every((s) => s === "done") ? "done" : "failed");

  console.log(`\n=== batch summary (${dur(now() - t0)}) ===`);
  for (const j of jobs) {
    const r = results[j.name];
    console.log(`${state[j.name].padEnd(8)} ${j.name.padEnd(20)} ${r?.id ? r.id.padEnd(36) : "".padEnd(36)} ${short(r?.model).padEnd(28)} files=${r?.filesTouched?.length ?? 0}${r?.outOfScope?.length ? "  WARNING outside scope: " + r.outOfScope.join(",") : ""}`);
  }
  for (const j of jobs) {
    const r = results[j.name];
    if (!r?.id) continue;
    console.log(`\n--- ${j.name}: last message ---\n${String(r.lastText || r.error || "(none)").trim().slice(-700)}`);
  }
  console.log(`\nDetails: oc report <id>. After verifying: oc rate <id> good|bad`);
  return Object.values(state).every((s) => s === "done") ? 0 : 1;
}

// ---------- model views ----------
function printRanking(kind, top = 8, level) {
  const minLevel = level !== undefined ? level : KIND_MIN_LEVEL[kind];
  const rows = rankModels(kind).filter((r) => {
    const mdlLvl = modelLevel(r.model);
    return mdlLvl >= minLevel;
  }).slice(0, top);
  console.log(`ranking for kind=${kind} (bench tasks: ${KIND_TASKS[kind].join("+")}; score = quality x reliability, blended with your ratings)`);
  console.log("  #  model                                    tier runner  score  bench  rated  rel   time   jobs  good/bad  lvl");
  rows.forEach((r, i) => {
    console.log(`  ${i + 1}  ${short(r.model).padEnd(40)} ${modelTier(r.model).padEnd(4)} ${modelRunner(r.model).padEnd(6)} ${pct(r.score)}  ${pct(r.quality)}  ${pct(r.feedback)}  ${pct(r.reliability)} ${String(Math.round(r.secs)).padStart(5)}s ${String(r.jobs).padStart(5)}  ${r.good}/${r.bad}  ${String(modelLevel(r.model)).padStart(3)}`);
  });
  const chainMinLevel = level !== undefined ? level : KIND_MIN_LEVEL[kind];
  const chain = resolveChain({ kind, fallbacks: DEFAULT_FALLBACKS, level: chainMinLevel });
  console.log(`  -> --kind ${kind} uses: ${chain.map(short).join(" > ")}`);
}

function listModels() {
  const db = loadModels(), stats = loadStats(), available = availableModels();
  console.log(`default model: ${DEFAULT_MODEL}   bench updated: ${db.updated || "never (run: oc bench)"}`);
  const cq = claudeQuota();
  const q = codexQuota();
  console.log(`codex quota: ${q.used}/${q.max} job(s) in the last 5 h${q.blocked ? `  (${q.reason}; codex skipped for auto picks)` : ""}  |  claude quota: ${cq.used}/${cq.max} job(s) in the last 5 h${cq.blocked ? `  (${cq.reason}; claude skipped for auto picks)` : ""}\n`);
  console.log("model                                      tier runner   fix  code    ui smoke |  quick  code    ui  hard | jobs ok infra  good/bad  lvl");
  const rankOf = {};
  for (const k of KINDS) rankModels(k).forEach((r, i) => ((rankOf[r.model] ||= {})[k] = i + 1));
  for (const m of available) {
    const b = db.models[m]?.bench || {};
    const s = stats.models[m] || {};
    const cell = (t) => (b[t] ? pct(b[t].score).padStart(5) : "    -");
    const ranks = KINDS.map((k) => `#${rankOf[m]?.[k] ?? "-"}`.padStart(6)).join("");
    const lvl = modelLevel(m);
    console.log(`${(m === DEFAULT_MODEL ? "*" : " ") + short(m).padEnd(40)} ${modelTier(m).padEnd(4)} ${modelRunner(m).padEnd(6)} ${cell("fix")} ${cell("code")} ${cell("ui")} ${cell("smoke")} |${ranks} | ${String(s.jobs || 0).padStart(4)} ${String(s.done || 0).padStart(2)} ${String(s.infra || 0).padStart(5)}  ${s.good || 0}/${s.bad || 0}  ${String(lvl).padStart(3)}`);
  }
  const gone = Object.keys(db.models).filter((m) => !available.includes(m));
  if (gone.length) console.log(`\nno longer offered: ${gone.map(short).join(", ")}`);
  console.log("\nfree = opencode/* + ollama/* (local); paid = claude/* (Claude plan) + codex/* (ChatGPT plan).");
  console.log("Paid models only join an auto pick or fallback chain with --paid (batch \"paid\": true) or OC_URGENT=1.");
  console.log("Other opencode providers (Anthropic, OpenAI, ...) appear after `opencode auth login`; then run `oc bench <model>`.");
}

// ---------- dashboard ----------
const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m" };
const STATUS_COLOR = { running: C.cyan, done: C.green, failed: C.red, timeout: C.red, stalled: C.yellow, stopped: C.magenta, lost: C.yellow, blocked: C.magenta };
const pad = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n); };

function dash(opt = {}) {
  let selected = null; // pinned job id, or null = follow the newest running job
  let showModels = !!opt.models;
  let rankCache = { at: 0, rows: {} };
  const draw = () => {
    const cols = process.stdout.columns || 120, rows = process.stdout.rows || 40;
    const jobs = allJobs().slice(0, 9);
    const running = jobs.filter((j) => j.status === "running");
    const focus = jobs.find((j) => j.id === selected) || running[0] || jobs[0];
    const out = [];
    const right = `${running.length}/${machineLimits().maxTotal} running  ${hhmmss(now())}`;
    out.push(`${C.bold} opencode jobs${C.reset}${" ".repeat(Math.max(1, cols - 14 - right.length - 1))}${C.cyan}${right}${C.reset}`);
    out.push(C.gray + "─".repeat(cols) + C.reset);
    out.push(C.dim + `   # ${pad("NAME", 22)} ${pad("MODEL", 24)} ${pad("KIND", 5)} ${pad("STATUS", 10)} ${pad("TIME", 7)} ${pad("STEP", 4)} ${pad("TOKENS", 7)} ${pad("FILES", 5)} LAST` + C.reset);
    jobs.forEach((j, i) => {
      const t = (j.endedAt || now()) - j.startedAt;
      const idle = j.status === "running" ? now() - j.lastEventAt : 0;
      const st = idle > 90000 ? `idle ${Math.round(idle / 1000)}s` : j.status + (j.rating ? (j.rating === "good" ? " ✓" : " ✗") : "");
      const mark = focus && j.id === focus.id ? C.bold + "›" + C.reset : " ";
      const color = idle > 90000 ? C.yellow : STATUS_COLOR[j.status] || "";
      const warn = j.outOfScope?.length ? `${C.red} !scope${C.reset}` : "";
      const name = j.attempt > 1 ? `${j.name} ↻${j.attempt}` : j.name;
      const lastW = Math.max(10, cols - 98);
      out.push(` ${mark} ${i + 1} ${pad(name, 22)} ${pad(short(j.model), 24)} ${pad(j.kind || "", 5)} ${color}${pad(st, 10)}${C.reset} ${pad(dur(t), 7)} ${pad(j.steps, 4)} ${pad(kfmt(j.tokens), 7)} ${pad(j.filesTouched?.length || 0, 5)} ${C.dim}${pad(j.lastActivity, lastW)}${C.reset}${warn}`);
    });
    if (!jobs.length) out.push(C.dim + "   (chưa có job nào - Claude sẽ chạy job bằng `oc run` / `oc batch`)" + C.reset);
    out.push(C.gray + "─".repeat(cols) + C.reset);
    if (showModels) {
      if (now() - rankCache.at > 30000) {
        rankCache = { at: now(), rows: Object.fromEntries(KINDS.map((k) => { try { return [k, rankModels(k).slice(0, 5)]; } catch { return [k, []]; } })) };
      }
      out.push(`${C.bold} model ranking${C.reset}  ${C.dim}score = bench quality x reliability, blended with ratings (oc rate)${C.reset}`);
      const colW = Math.max(28, Math.floor((cols - 2) / KINDS.length));
      out.push(" " + KINDS.map((k) => C.bold + pad(k.toUpperCase(), colW) + C.reset).join(""));
      for (let i = 0; i < 5; i++) {
        out.push(" " + KINDS.map((k) => {
          const r = rankCache.rows[k]?.[i];
          return r ? pad(`${i + 1}. ${String(Math.round(r.score * 100)).padStart(3)}%  ${short(r.model).replace(/-free$/, "")}`, colW) : pad("", colW);
        }).join(""));
      }
    } else if (focus) {
      out.push(`${C.bold} live: ${focus.name}${C.reset}  ${C.dim}${focus.title || ""}${selected ? "  (đã ghim)" : ""}${C.reset}`);
      let tail = [];
      try { tail = fs.readFileSync(path.join(JOBS, focus.id, "job.log"), "utf8").trimEnd().split(/\r?\n/); } catch {}
      const room = Math.max(3, rows - out.length - 2);
      for (const l of tail.slice(-room)) {
        let c = C.dim;
        if (/^\S+\s+(ERROR|WARN|RETRY)/.test(l) || l.includes("!!")) c = C.red;
        else if (/^\S+\s+say /.test(l)) c = C.reset;
        else if (/^\S+\s+(write|edit|multiedit|patch|apply_patch) /.test(l)) c = C.green;
        else if (/^\S+\s+bash /.test(l)) c = C.yellow;
        else if (/^\S+\s+(START|END)/.test(l)) c = C.bold + C.cyan;
        out.push(c + " " + l.slice(0, cols - 2) + C.reset);
      }
    }
    while (out.length < rows - 1) out.push("");
    out.push(C.dim + " 1-9 ghim job · a theo job mới nhất · m bảng xếp hạng model · q thoát" + C.reset);
    process.stdout.write("\x1b[H\x1b[2J" + out.slice(0, rows).join("\n"));
  };
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on("keypress", (str, key) => {
      if (key && (key.name === "q" || (key.ctrl && key.name === "c"))) { process.stdout.write("\x1b[?25h\n"); process.exit(0); }
      if (str === "a") { selected = null; showModels = false; }
      if (str === "m") showModels = !showModels;
      if (/^[1-9]$/.test(str || "")) {
        const j = allJobs().slice(0, 9)[Number(str) - 1];
        if (j) { selected = j.id; showModels = false; }
      }
      draw();
    });
  }
  process.stdout.write("\x1b[?25l");
  draw();
  setInterval(draw, 1000);
}

// ---------- main ----------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case "run": {
      if (!pos[0]) throw new OcError("usage: oc run <brief> [--kind k] [--model m|auto] [--dir d] [--scope a,b] [--name n]");
      const job = await runJob({
        brief: pos[0], model: opt.model, kind: opt.kind, fallbacks: opt.fallbacks,
        variant: opt.variant, agent: opt.agent, dir: opt.dir, scope: opt.scope, name: opt.name, allowExternal: opt["allow-external"],
        paid: !!opt.paid, level: Number(opt.level || 0),
        timeout: Number(opt.timeout || process.env.OPENCODE_TIMEOUT || 900), stall: Number(opt.stall || 300),
        force: !!opt.force, wait: !opt["no-wait"], quiet: !!opt.quiet || process.env.OC_QUIET === "1",
      });
      console.log("\n" + report(job));
      return { done: 0, timeout: 124, stalled: 125, blocked: 126 }[job.status] ?? 1;
    }
    case "batch":
      if (!pos[0]) throw new OcError("usage: oc batch <plan.json> [--dry-run]");
      return runBatch(pos[0], opt);
    case "pick":
      const kindsList = pos.length ? pos : (opt.kind ? [opt.kind] : KINDS);
      for (const k of kindsList) { printRanking(k, Number(opt.top || 8), Number(opt.level || 0)); console.log(); }
      return 0;
    case "models":
      listModels();
      return 0;
    case "bench": {
      const { bench } = await import("./bench.mjs");
      await bench(pos, opt);
      return 0;
    }
    case "rate": {
      const [ref, verdict] = pos;
      const j = await rateJob(ref, verdict, opt.note === true ? "" : opt.note || "");
      console.log(`rated ${j.id} (${short(j.model)}${j.kind ? ", " + j.kind : ""}) ${verdict}`);
      return 0;
    }
    case "list": {
      const jobs = allJobs().slice(0, opt.all ? 1000 : 15);
      if (!jobs.length) { console.log("no jobs"); return 0; }
      for (const j of jobs) {
        const t = (j.endedAt || now()) - j.startedAt;
        console.log(`${pad(j.id, 38)} ${pad(j.status, 8)} ${pad(dur(t), 7)} ${pad(short(j.model), 28)} ${pad(j.kind || "", 5)} files=${j.filesTouched?.length || 0}${j.outOfScope?.length ? " !scope" : ""}${j.rating ? " " + j.rating : ""}  ${oneLine(j.lastActivity, 50)}`);
      }
      return 0;
    }
    case "selftest": {
      // Syntax, CLI, provider rules, dashboard API and real clicks; no model calls, throwaway data folder.
      const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "selftest.mjs"), ...rest], { stdio: "inherit" });
      return r.status ?? 1;
    }
    case "keys": {
      // API-key providers. Keys live in opencode's credential store; Maestro only keeps on/off + daily budget.
      const [sub = "list", id, value] = pos;
      const cfgAll = () => loadProviderSettings().providers;
      const need = () => {
        if (!id || !providerInfo(id)) throw new OcError(`provider: ${PROVIDERS.map((p) => p.id).join(", ")}`, 2);
        return providerInfo(id);
      };
      const refreshModels = () => { try { fs.rmSync(path.join(JOBS, ".models-cache.json"), { force: true }); } catch {} modelCache = null; };
      if (sub === "list" || sub === "ls") {
        const conn = connectedProviders(), cfg = cfgAll();
        const models = availableModels();
        console.log("provider".padEnd(14) + "key".padEnd(10) + "on".padEnd(5) + "billing".padEnd(11) + "budget/day".padEnd(12) + "today".padEnd(14) + "models");
        for (const p of PROVIDERS) {
          const c = cfg[p.id] || {}, sp = spentToday(p.id);
          const n = models.filter((m) => providerOf(m) === p.id).length;
          console.log(p.id.padEnd(14) + (conn[p.id] || "-").padEnd(10) + (c.enabled ? "yes" : "no").padEnd(5) + p.billing.padEnd(11) +
            (p.billing === "paid" ? `$${(c.budgetUsd || 0).toFixed(2)}` : "-").padEnd(12) + `$${sp.usd.toFixed(2)} ${sp.jobs} job`.padEnd(14) + n);
        }
        console.log("\nadd a key: maestro keys add <provider>   then: maestro keys enable <provider> [--budget <usd/day>]");
        console.log("paid providers are used only with --paid (or batch \"paid\": true) and stop for the day at their budget.");
        return 0;
      }
      if (sub === "add") {
        const p = need();
        console.log(`Get a key: ${p.keyUrl}\nopencode will ask for it and store it (Maestro never sees it).`);
        const r = spawnSync(opencodeBin(), ["auth", "login", "-p", p.id], { stdio: "inherit" });
        refreshModels();
        if (r.status === 0) console.log(`\n${p.name} connected. Turn it on: maestro keys enable ${p.id}${p.billing === "paid" ? " --budget 2" : ""}`);
        return r.status ?? 1;
      }
      if (sub === "remove" || sub === "logout") {
        const p = need();
        const r = spawnSync(opencodeBin(), ["auth", "logout", p.id], { stdio: "inherit" });
        saveProviderSetting(p.id, { enabled: false });
        refreshModels();
        return r.status ?? 1;
      }
      if (sub === "enable" || sub === "disable") {
        const p = need();
        const patch = { enabled: sub === "enable" };
        if (opt.budget !== undefined && opt.budget !== true) patch.budgetUsd = opt.budget;
        const next = saveProviderSetting(p.id, patch);
        console.log(`${p.name}: ${next.enabled ? "on" : "off"}${p.billing === "paid" ? `, budget $${(next.budgetUsd || 0).toFixed(2)}/day` : ""}`);
        if (next.enabled && p.billing === "paid" && !next.budgetUsd) console.log(`set a daily budget first: maestro keys budget ${p.id} <usd>`);
        return 0;
      }
      if (sub === "budget") {
        const p = need();
        const next = saveProviderSetting(p.id, { budgetUsd: value });
        console.log(`${p.name}: budget $${next.budgetUsd.toFixed(2)}/day`);
        return 0;
      }
      throw new OcError("usage: maestro keys [list] | add <provider> | remove <provider> | enable|disable <provider> [--budget usd] | budget <provider> <usd>", 2);
    }
    case "limits": {
      const L = machineLimits();
      const running = allJobs().filter((j) => j.status === "running").length;
      const freeMb = Math.round(os.freemem() / 1048576);
      // Compute CPU busy % (same logic as limits.mjs cpuBusy)
      const snap = () => os.cpus().reduce((a, c) => {
        const t = c.times;
        a.idle += t.idle;
        a.total += t.user + t.nice + t.sys + t.idle + t.irq;
        return a;
      }, { idle: 0, total: 0 });
      const a = snap();
      const until = Date.now() + 250;
      while (Date.now() < until) { /* short busy wait */ }
      const b = snap();
      const total = b.total - a.total;
      const busy = total > 0 ? 1 - (b.idle - a.idle) / total : 0;
      console.log(`maxTotal: ${L.maxTotal}  maxPerModel: ${L.maxPerModel}  maxLocal: ${L.maxLocal}`);
      console.log(`running: ${running}  free RAM: ${freeMb} MB  CPU busy: ${Math.round(busy * 100)}%`);
      return 0;
    }
    case "report":
      console.log(report(findJob(pos[0])));
      return 0;
    case "log": {
      const j = findJob(pos[0]);
      const lines = fs.readFileSync(path.join(JOBS, j.id, "job.log"), "utf8").trimEnd().split(/\r?\n/);
      console.log(lines.slice(-Number(opt.lines || 60)).join("\n"));
      return 0;
    }
    case "stop":
      if (!pos[0]) { console.error("cần id job"); return 1; }
      try {
        for (const line of stopJob(pos[0])) console.log(line);
      } catch (e) {
        if (e instanceof OcError) {
          if (e.message === "cần id job") { console.error(e.message); return 1; }
          console.error(`oc: ${e.message}`);
          return 1;
        }
        console.error(`oc: ${e.message}`);
        return 1;
      }
      return 0;
    case "pause":
      console.log(pauseJob(pos[0] || "last"));
      return 0;
    case "resume":
      console.log(resumeJob(pos[0] || "last"));
      return 0;
    case "pause-batch":
      console.log(pauseBatch(pos[0] || "last"));
      return 0;
    case "resume-batch":
      console.log(resumeBatch(pos[0] || "last"));
      return 0;
    case "dash":
      dash(opt);
      return null; // keeps running
    case "web": {
      // Browser dashboard (dash-web.mjs): jobs per project, live logs, model ranking, running processes.
      // --app: open it as a standalone window (Edge app mode: no tabs, no address bar).
      // --restart: stop a dashboard server that is already running (to load new code), then start fresh.
      const appMode = rest.includes("--app");
      const restart = rest.includes("--restart");
      const args = rest.filter((a) => a !== "--app" && a !== "--restart");
      const port = opt.port && opt.port !== true ? Number(opt.port) : 4790;
      const url = `http://localhost:${port}`;
      const openWindow = () => {
        if (!appMode) return;
        if (IS_WIN) spawn("cmd", ["/c", "start", "", "msedge", `--app=${url}`, "--window-size=1440,900"], { stdio: "ignore", windowsHide: true, detached: true }).unref();
        else console.log(`open ${url}`);
      };
      const up = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
      if (await up()) {
        if (!restart) { console.log(`dashboard already running at ${url}`); openWindow(); return 0; }
        if (IS_WIN) {
          spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dash-web.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { windowsHide: true });
        }
        for (let i = 0; i < 20 && (await up()); i++) await sleep(250);
        console.log("stopped the old dashboard server");
      }
      const child = spawn(process.execPath, [path.join(SKILL_DIR, "dash-web.mjs"), ...args], { stdio: "inherit", windowsHide: true });
      child.on("exit", (code) => process.exit(code ?? 0));
      setTimeout(openWindow, 1200);
      return null;
    }
    case "open":
    case "dashboard":
    case "close":
    case "status":
    case "restart": {
      // Background dashboard app: open (start hidden server + app window), close (stop it), status. See launch-app.mjs.
      const r = spawnSync(process.execPath, [path.join(SKILL_DIR, "launch-app.mjs"), cmd === "dashboard" ? "open" : cmd], { stdio: "inherit" });
      return r.status ?? 0;
    }
    case "clean": {
      const days = Number(opt.days || 7);
      let n = 0;
      for (const j of allJobs()) {
        if (j.status !== "running" && now() - j.startedAt > days * 864e5) {
          fs.rmSync(path.join(JOBS, j.id), { recursive: true, force: true });
          n++;
        }
      }
      console.log(`removed ${n} job folders older than ${days} days`);
      return 0;
    }
    case "doctor": {
      const checks = [];
      // 1. node version
      checks.push("✔ node " + process.version);
      // 2. opencode found + version
      const ocBin = opencodeBin();
      const ocExists = fs.existsSync(ocBin);
      const ocStr = ocExists ? "✔" : "✘";
      const ocMsg = ocExists ? "opencode found at " + ocBin : "opencode not found (install opencode)";
      checks.push(ocStr + " " + ocMsg);
      if (ocExists) {
        try { checks[1] += " v" + require(ocBin).version; } catch { checks[1] += " (version unknown)"; }
      }
      // 3. ollama reachable
      const ollamaTags = ollamaModels();
      const ollamaOk = ollamaTags.length > 0;
      const ollamaStr = ollamaOk ? "✔" : "✘";
      const ollamaMsg = ollamaOk ? "ollama reachable" : "ollama not running (start: ollama serve)";
      checks.push(ollamaStr + " " + ollamaMsg);
      // 4. claude CLI found
      const claudeFound = whichBin("claude");
      const claudeStr = claudeFound ? "✔" : "✘";
      const claudeMsg = claudeFound ? "claude CLI found at " + claudeFound : "claude CLI not found (install or set CLAUDE_BIN)";
      checks.push(claudeStr + " " + claudeMsg);
      // 5. codex CLI found
      const codexFound = whichBin("codex");
      const codexStr = codexFound ? "✔" : "✘";
      const codexMsg = codexFound ? "codex CLI found at " + codexFound : "codex CLI not found (install or set CODEX_BIN)";
      checks.push(codexStr + " " + codexMsg);
      // 6. Antigravity CLI found (%LOCALAPPDATA%/Programs/Antigravity IDE/bin/antigravity-ide.cmd)
      const antigravityCmd = path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd");
      const antigravityOk = fs.existsSync(antigravityCmd);
      const antigravityStr = antigravityOk ? "✔" : "✘";
      const antigravityMsg = antigravityOk ? "Antigravity IDE found" : "Antigravity IDE not found at " + antigravityCmd;
      checks.push(antigravityStr + " " + antigravityMsg);
      // 7. agy-bridge running (discovery file %TEMP%/opencode-jobs/.agy-bridge.json + GET /health)
      const agyDiscovery = path.join(JOBS, ".agy-bridge.json");
      let agyRunning = false;
      if (fs.existsSync(agyDiscovery)) {
        try {
          const agyData = readJSON(agyDiscovery, {});
          agyRunning = !!agyData && agyData.status !== "stopped";
        } catch { }
      }
      const agyStr = agyRunning ? "✔" : "✘";
      const agyMsg = agyRunning ? "agy-bridge running" : "agy-bridge not running (start agy-bridge)";
      checks.push(agyStr + " " + agyMsg);
      // 8. dashboard answering on 4790
      const dashPort = 4790;
      const dashOk = await (async () => { try { const r = await fetch("http://127.0.0.1:" + dashPort + "/api/state", { signal: AbortSignal.timeout(1000) }); return r.ok; } catch { return false; } })();
      const dashStr = dashOk ? "✔" : "✘";
      const dashMsg = dashOk ? "dashboard answering on 4790" : "dashboard not running on 4790 (start: oc dash or oc open)";
      checks.push(dashStr + " " + dashMsg);
      // 9. jobs dir writable
      const jobsDirWritable = fs.existsSync(JOBS) || fs.mkdirSync(JOBS, { recursive: true });
      const jobsStr = jobsDirWritable ? "✔" : "✘";
      const jobsMsg = jobsDirWritable ? "jobs dir writable" : "jobs dir not writable (check permissions)";
      checks.push(jobsStr + " " + jobsMsg);
      // 10. bench data age
      const stats = loadStats();
      const hasBenchData = Object.keys(stats.models || {}).length > 0;
      const benchStr = hasBenchData ? "✔" : "✘";
      const benchMsg = hasBenchData ? "bench data exists" : "no bench data (run: oc bench <model>)";
      checks.push(benchStr + " " + benchMsg);
      // Print checklist - hints only on ✘ lines, and only after first 3 checks
      checks.forEach((c, i) => {
        const isMissing = c.startsWith("✘");
        const parts = c.split(" ");
        const msg = parts.slice(1).join(" ");
        const hint = isMissing && i >= 3 ? "  (run 'oc bench <model>' to collect data)" : "";
        console.log((isMissing ? "✘" : "✔") + " " + msg + hint);
      });
      return 0;
    }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      return 0;
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (IS_WIN ? entry.toLowerCase() === self.toLowerCase() : entry === self) {
  main().then((code) => { if (code !== null && code !== undefined) process.exit(code); })
    .catch((e) => { console.error(`oc: ${e.message}`); process.exit(e instanceof OcError ? e.code : 1); });
}
