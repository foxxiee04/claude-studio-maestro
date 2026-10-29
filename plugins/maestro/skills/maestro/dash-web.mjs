#!/usr/bin/env node
// dash-web - local browser dashboard for oc jobs, model ranking and running processes.
//   node dash-web.mjs [--port 4790] [--open]
// Binds 127.0.0.1 only. No npm dependencies.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { machineLimits } from "./limits.mjs";
import {
  allJobs, allBatches, rateJob, stopJob, rankModels, KINDS, loadModels,
  availableModels, JOBS, OcError, pauseJob, resumeJob, pauseBatch, resumeBatch,
} from "./oc.mjs";
import {
  PROVIDERS, connectedProviders, loadProviderSettings, saveProviderSetting,
  spentToday, providerOf,
} from "./providers.mjs";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(process.env.MAESTRO_DATA || SKILL_DIR, "stats.json");
const WEB_DIR = path.join(SKILL_DIR, "web");
const INDEX_FILE = path.join(WEB_DIR, "index.html");
const IS_WIN = process.platform === "win32";
// Same machine-based limit as the controller (limits.mjs), so "1/6" in the title bar matches what oc enforces.
const MAX_PARALLEL = machineLimits().maxTotal;

let cpuCache = { at: 0, busy: 0 };
function sampleCpuBusy() {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
  const a = snap();
  const until = Date.now() + 200;
  while (Date.now() < until) { /* sample */ }
  const b = snap();
  const total = b.total - a.total;
  return total > 0 ? 1 - (b.idle - a.idle) / total : 0;
}
function cpuBusy() {
  if (Date.now() - cpuCache.at > 5000) cpuCache = { at: Date.now(), busy: sampleCpuBusy() };
  return cpuCache.busy;
}

const argv = process.argv.slice(2);
function optValue(name, fallback) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) {
      const next = argv[i + 1];
      return next && !next.startsWith("--") ? next : true;
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}
const portArg = optValue("port", 4790);
const PORT = portArg === true ? 4790 : Number(portArg) || 4790;
const OPEN = !!optValue("open", false);

// ---------- helpers ----------
const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

const PS_QUERY =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|opencode|powershell|pwsh|claude)\\.exe$' } " +
  "| Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Depth 2";

function shortCmd(cmd, n = 140) {
  const s = String(cmd || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (!v) return null;
  const m = /\/Date\((-?\d+)(?:[+-]\d+)?\)\//.exec(String(v));
  if (m) return Number(m[1]);
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function safeId(raw) {
  let id;
  try { id = decodeURIComponent(String(raw || "")); } catch { return null; }
  if (!/^[\w.-]+$/.test(id)) return null;
  if (id === "." || id === "..") return null;
  return id;
}

function jobFolder(id) {
  const dir = path.join(JOBS, id);
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch { return null; }
  return dir;
}

function tailText(file, maxBytes = 512 * 1024) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const len = st.size - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  let text = buf.toString("utf8");
  if (start > 0) {
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);
  }
  return text;
}

function basename(p) {
  const s = String(p || "").replace(/[\\/]+$/, "");
  return s.split(/[\\/]/).pop() || s || "";
}

// ---------- opencode version (run once, cached) ----------
function opencodeBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (IS_WIN) {
    const exe = path.join(process.env.APPDATA || "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "opencode";
}

let versionValue = null;
let versionPromise = null;
function getOpencodeVersion() {
  if (!versionPromise) {
    versionPromise = new Promise((resolve) => {
      try {
        execFile(opencodeBin(), ["--version"], { windowsHide: true, timeout: 10000, encoding: "utf8" },
          (err, stdout) => {
            if (!err && stdout && String(stdout).trim()) {
              versionValue = String(stdout).trim().split(/\r?\n/)[0].trim();
            }
            resolve(versionValue);
          });
      } catch { resolve(null); }
    });
  }
  return versionPromise;
}

// ---------- ranking (30 s cache) ----------
let rankCache = { at: 0, data: {} };
function buildRanking() {
  const out = {};
  for (const kind of KINDS) {
    try {
      out[kind] = rankModels(kind).slice(0, 5).map((r) => ({
        model: r.model, score: r.score, quality: r.quality, feedback: r.feedback,
        reliability: r.reliability, secs: r.secs, jobs: r.jobs,
      }));
    } catch { out[kind] = []; }
  }
  return out;
}
function getRanking() {
  if (Date.now() - rankCache.at < 30_000) return rankCache.data;
  rankCache = { at: Date.now(), data: buildRanking() };
  return rankCache.data;
}

// ---------- model table (30 s cache) ----------
const BENCH_TASKS = ["fix", "code", "ui", "smoke"];
let modelsCache = { at: 0, data: null };

function buildModels() {
  const db = loadModels();
  const stats = readJSON(STATS_FILE, { models: {} });
  let avail = [];
  try { avail = availableModels() || []; } catch { avail = []; }

  const rows = new Map();
  const ensure = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        id, model: id, short: String(id).replace(/^opencode\//, ""),
        note: "", bench: {}, ranks: {},
        stats: { jobs: 0, done: 0, failed: 0, infra: 0, good: 0, bad: 0, secs: 0, avgSecs: null, deadUntil: null, success: null },
      });
    }
    return rows.get(id);
  };

  for (const id of Object.keys(db.models || {})) ensure(id);
  for (const id of avail) ensure(id);

  for (const [id, m] of Object.entries(db.models || {})) {
    const row = ensure(id);
    row.note = m?.note || "";
    const bench = m?.bench || {};
    for (const task of BENCH_TASKS) {
      const b = bench[task];
      if (!b || typeof b !== "object") continue;
      row.bench[task] = {
        score: Number(b.score) || 0,
        seconds: Number(b.seconds) || 0,
        status: b.status || null,
        tested: b.tested || null,
        skipped: !!b.skipped,
      };
    }
  }

  for (const kind of KINDS) {
    let ranked = [];
    try { ranked = rankModels(kind) || []; } catch { ranked = []; }
    ranked.forEach((r, i) => {
      const row = ensure(r.model);
      row.ranks[kind] = i + 1;
    });
  }

  for (const row of rows.values()) {
    const s = stats.models?.[row.id] || {};
    const jobs = Number(s.jobs) || 0;
    const secs = Number(s.secs) || 0;
    row.stats = {
      jobs,
      done: Number(s.done) || 0,
      failed: Number(s.failed) || 0,
      infra: Number(s.infra) || 0,
      good: Number(s.good) || 0,
      bad: Number(s.bad) || 0,
      secs,
      avgSecs: jobs ? Math.round(secs / jobs) : null,
      deadUntil: Number(s.deadUntil) || null,
      success: jobs ? (Number(s.done) || 0) / jobs : null,
    };
  }

  return { now: Date.now(), updated: db.updated || null, kinds: KINDS, models: [...rows.values()] };
}

function getModels() {
  if (modelsCache.data && Date.now() - modelsCache.at < 30_000) return modelsCache.data;
  let data;
  try { data = buildModels(); } catch { data = { now: Date.now(), updated: null, kinds: KINDS, models: [] }; }
  modelsCache = { at: Date.now(), data };
  return data;
}

// ---------- providers ----------
function listProviders() {
  const connectedMap = connectedProviders();
  const settings = loadProviderSettings();
  const models = (getModels()?.models) || [];
  return PROVIDERS.map((p) => {
    const s = settings.providers?.[p.id] || {};
    const spent = spentToday(p.id);
    const modelCount = models.filter((m) => m && m.id && (m.id.startsWith(p.id + "/") || providerOf(m.id) === p.id)).length;
    return {
      id: p.id,
      name: p.name,
      billing: p.billing,
      keyUrl: p.keyUrl,
      connected: connectedMap[p.id] || null,
      enabled: !!s.enabled,
      budgetUsd: Number(s.budgetUsd) || 0,
      spentUsd: Number(spent?.usd) || 0,
      jobsToday: Number(spent?.jobs) || 0,
      models: modelCount,
    };
  });
}

function getProviderObject(id) {
  const list = listProviders();
  return list.find((p) => p.id === id) || null;
}

// ---------- timeline ----------
function timelinePayload(hoursParam) {
  const hours = Math.min(168, Math.max(0.25, Number(hoursParam) || 6));
  const now = Date.now();
  const from = now - hours * 3600_000;
  const jobs = [];
  let list = [];
  try { list = allJobs(); } catch { list = []; }
  for (const j of list) {
    const started = Number(j.startedAt);
    if (!Number.isFinite(started) || !started) continue;
    const ended = Number(j.endedAt) || null;
    const live = j.status === "running" || j.status === "lost";
    const end = ended || (live ? now : now);
    if (end < from) continue;
    if (started > now) continue;
    jobs.push({
      id: j.id,
      name: j.name || j.id,
      project: basename(j.dir) || "(không rõ)",
      dir: j.dir || "",
      status: j.status || "lost",
      model: j.model || null,
      kind: j.kind || null,
      startedAt: started,
      endedAt: ended,
      tokens: Number(j.tokens) || 0,
      batch: j.batch || null,
    });
  }
  jobs.sort((a, b) => a.startedAt - b.startedAt);
  return { now, hours, from, to: now, jobs };
}

// ---------- processes (5 s cache) ----------
let procCache = { at: 0, list: [] };
let procInflight = null;

function getRawProcesses() {
  if (!IS_WIN) return Promise.resolve([]);
  if (Date.now() - procCache.at < 5000) return Promise.resolve(procCache.list);
  if (procInflight) return procInflight;
  procInflight = new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-Command", PS_QUERY],
      { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        procInflight = null;
        if (!err && stdout && stdout.trim()) {
          let list = [];
          try {
            const parsed = JSON.parse(stdout);
            list = Array.isArray(parsed) ? parsed : [parsed];
          } catch { list = []; }
          if (list.length) procCache = { at: Date.now(), list };
          resolve(procCache.list);
          return;
        }
        resolve(procCache.list);
      });
  });
  return procInflight;
}

const TYPE_ORDER = ["opencode job", "oc controller", "dashboard", "dev server", "powershell", "claude", "opencode", "node"];

function classifyProcesses(raw, jobs) {
  const jobByPid = new Map();
  const jobStatusByPid = new Map();
  for (const j of jobs) {
    if (!j.pid) continue;
    const pid = Number(j.pid);
    jobByPid.set(pid, j.id);
    jobStatusByPid.set(pid, j.status);
  }
  const childCount = new Map();
  for (const p of raw) {
    const ppid = Number(p.ParentProcessId);
    if (ppid) childCount.set(ppid, (childCount.get(ppid) || 0) + 1);
  }
  const out = [];
  for (const p of raw) {
    const pid = Number(p.ProcessId);
    const ppid = Number(p.ParentProcessId);
    const name = String(p.Name || "").toLowerCase();
    const cmd = String(p.CommandLine || "");
    const low = cmd.toLowerCase();
    if (!Number.isFinite(pid)) continue;
    // Our own one-shot PowerShell query is not a workload.
    if (ppid === process.pid && low.includes("get-ciminstance win32_process")) continue;

    const row = {
      pid, ppid, name: String(p.Name || ""), type: "node", label: "node", mode: null,
      cmd: shortCmd(cmd, 600), cmdShort: shortCmd(cmd), startedAt: toMs(p.CreationDate),
      children: childCount.get(pid) || 0, jobId: null, orphan: false,
    };

    if (name === "opencode.exe") {
      if (/(^|[\s"'])run([\s"']|$)/.test(low)) {
        row.type = "opencode job";
        row.label = "opencode job";
        row.jobId = jobByPid.get(pid) || null;
        const status = jobStatusByPid.get(pid);
        // The pid still belongs to a job that already finished: a leftover child process.
        row.orphan = !!(row.jobId && status && status !== "running");
      } else {
        row.type = "opencode";
        row.label = "opencode";
      }
    } else if (name === "node.exe" || name === "node") {
      if (/\boc\.mjs\b/.test(low) && /\b(run|batch|bench)\b/.test(low)) {
        const m = /\b(run|batch|bench)\b/.exec(low);
        row.type = "oc controller";
        row.label = "oc controller";
        row.mode = m ? m[1] : null;
      } else if (/\bdash-web\.mjs\b/.test(low) || (/\boc\.mjs\b/.test(low) && /\bdash\b/.test(low))) {
        row.type = "dashboard";
        row.label = "dashboard";
      } else if (/next-server|next[\\/]dist[\\/]bin[\\/]next|(^|[\s"'\\/])next(\s|$)|(^|[\s"'\\/])vite(\.js)?(\s|$)/.test(low)) {
        row.type = "dev server";
        row.label = "dev server";
      }
    } else if (name === "powershell.exe" || name === "pwsh.exe") {
      row.type = "powershell";
      row.label = "PowerShell";
    } else if (name === "claude.exe") {
      row.type = "claude";
      row.label = "Claude Code";
    }
    out.push(row);
  }
  out.sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.type), tb = TYPE_ORDER.indexOf(b.type);
    if (ta !== tb) return ta - tb;
    return (a.startedAt || 0) - (b.startedAt || 0);
  });
  return out;
}

// ---------- state ----------
function pausedAtOf(j) {
  if (!j || !j.paused) return null;
  try {
    const st = fs.statSync(path.join(JOBS, j.id, "pause.flag"));
    return st.mtimeMs || null;
  } catch { return null; }
}

function slimJob(j) {
  // Only the fields the page uses for lists and live cards. The drawer fetches
  // the full job.json (lastText, filesTouched, tools, chain, ...) on open.
  return {
    id: j.id,
    name: j.name,
    title: j.title,
    model: j.model,
    kind: j.kind,
    attempt: j.attempt,
    dir: j.dir,
    scope: j.scope,
    batch: j.batch,
    batchJob: j.batchJob,
    status: j.status,
    paused: !!j.paused,
    pausedMs: Number(j.pausedMs) || 0,
    pausedAt: pausedAtOf(j),
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    lastEventAt: j.lastEventAt,
    steps: j.steps,
    tokens: j.tokens,
    lastActivity: j.lastActivity,
    error: j.error,
    rating: j.rating,
    ratingNote: j.ratingNote,
    denied: j.denied,
    outOfScope: j.outOfScope && j.outOfScope.length ? j.outOfScope.slice(0, 40) : [],
  };
}

function todayStats(jobs) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const today = { done: 0, failed: 0, running: 0, tokens: 0 };
  for (const j of jobs) {
    if (j.status === "running") today.running++;
    if (!j.startedAt || j.startedAt < t0) continue;
    today.tokens += Number(j.tokens) || 0;
    if (j.status === "done") today.done++;
    else if (["failed", "timeout", "stalled", "blocked", "lost"].includes(j.status)) today.failed++;
  }
  return today;
}

function groupProjects(jobs) {
  const groups = new Map();
  for (const j of jobs) {
    const dir = j.dir || "(không rõ)";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(j);
  }
  return [...groups.entries()].map(([dir, list]) => ({
    dir,
    name: path.basename(dir) || dir,
    count: list.length,
  }));
}

async function statePayload() {
  const jobs = allJobs();
  const slim = jobs.slice(0, 150).map(slimJob);
  const raw = await getRawProcesses();
  const stats = readJSON(STATS_FILE, { models: {} });
  return {
    now: Date.now(),
    maxParallel: MAX_PARALLEL,
    jobs: slim,
    projects: groupProjects(slim),
    ranking: getRanking(),
    stats,
    processes: classifyProcesses(raw, jobs),
    today: todayStats(jobs),
    benchUpdated: loadModels().updated || null,
  };
}

// ---------- metrics (10 s cache per range) ----------
const FAIL_STATUSES = new Set(["failed", "timeout", "stalled", "blocked", "lost"]);
const metricsCache = new Map();

function metricsWindow(range) {
  const now = Date.now();
  if (range === "7d") {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const from = day.getTime() - 6 * 86400_000;
    return { from, to: now, bucketMs: 86400_000, mode: "day", concurrencyStep: 3600_000 };
  }
  if (range === "today") {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    return { from: day.getTime(), to: now, bucketMs: 3600_000, mode: "hour", concurrencyStep: 300_000 };
  }
  const hour = 3600_000;
  const from = Math.floor(now / hour) * hour - 23 * hour;
  return { from, to: now, bucketMs: hour, mode: "hour", concurrencyStep: 300_000 };
}

function jobEnd(j, now) {
  const end = Number(j.endedAt);
  if (Number.isFinite(end) && end > 0) return end;
  return j.status === "running" ? now : Number(j.startedAt) || now;
}

function buildMetrics(range) {
  const win = metricsWindow(range);
  const now = win.to;
  let all = [];
  try { all = allJobs(); } catch { all = []; }

  const runningJobs = all.filter((j) => j.status === "running");
  const inRange = all.filter((j) => {
    const st = Number(j.startedAt);
    if (!Number.isFinite(st) || st > now) return false;
    return st >= win.from;
  });
  const scope = all.filter((j) => {
    const st = Number(j.startedAt);
    if (j.status === "running") return true;
    if (!Number.isFinite(st) || st > now) return false;
    return st >= win.from;
  });

  // jobsPerBucket
  const bucketCount = win.mode === "day"
    ? Math.max(1, Math.ceil((now - win.from) / win.bucketMs))
    : Math.max(1, Math.ceil((now - win.from) / win.bucketMs));
  const jobsPerBucket = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = win.from + i * win.bucketMs;
    jobsPerBucket.push({ t, done: 0, failed: 0, other: 0, tokens: 0 });
  }
  const bucketIndex = (at) => Math.floor((at - win.from) / win.bucketMs);
  for (const j of inRange) {
    const i = bucketIndex(Number(j.startedAt));
    const b = jobsPerBucket[i];
    if (!b) continue;
    b.tokens += Number(j.tokens) || 0;
    if (j.status === "done") b.done++;
    else if (FAIL_STATUSES.has(j.status)) b.failed++;
    else b.other++;
  }

  // statusCounts
  const statusCounts = {};
  for (const j of scope) {
    const s = j.status || "lost";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  // tokensByModel / jobsByModel
  const tokenMap = new Map();
  const jobMap = new Map();
  for (const j of scope) {
    const model = j.model || "(không rõ)";
    tokenMap.set(model, (tokenMap.get(model) || 0) + (Number(j.tokens) || 0));
    jobMap.set(model, (jobMap.get(model) || 0) + 1);
  }
  const tokensByModel = [...tokenMap.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
  const jobsByModel = [...jobMap.entries()]
    .map(([model, jobs]) => ({ model, jobs }))
    .sort((a, b) => b.jobs - a.jobs);

  // durationsByKind
  const kindMap = new Map();
  for (const j of scope) {
    const end = Number(j.endedAt);
    const st = Number(j.startedAt);
    if (!Number.isFinite(end) || !Number.isFinite(st) || end < st) continue;
    const kind = j.kind || "khác";
    const cur = kindMap.get(kind) || { seconds: 0, jobs: 0 };
    cur.seconds += (end - st) / 1000;
    cur.jobs++;
    kindMap.set(kind, cur);
  }
  const durationsByKind = KINDS.map((kind) => {
    const cur = kindMap.get(kind) || { seconds: 0, jobs: 0 };
    return { kind, count: cur.jobs, avgSeconds: cur.jobs ? Math.round(cur.seconds / cur.jobs) : 0 };
  });

  // concurrency samples
  const concurrency = [];
  const step = win.concurrencyStep;
  const samples = Math.max(1, Math.min(600, Math.ceil((now - win.from) / step)));
  for (let i = 0; i <= samples; i++) {
    const t = Math.min(now, win.from + i * step);
    let n = 0;
    for (const j of all) {
      const st = Number(j.startedAt);
      if (!Number.isFinite(st) || st > t) continue;
      if (jobEnd(j, now) > t) n++;
    }
    concurrency.push({ t, v: n });
  }

  // kpis + sparklines
  const finished = scope.filter((j) => {
    const end = Number(j.endedAt);
    const st = Number(j.startedAt);
    return Number.isFinite(end) && Number.isFinite(st) && end >= st;
  });
  const done = scope.filter((j) => j.status === "done").length;
  const failed = scope.filter((j) => FAIL_STATUSES.has(j.status)).length;
  const tokens = scope.reduce((sum, j) => sum + (Number(j.tokens) || 0), 0);
  let durationSum = 0;
  for (const j of finished) durationSum += Number(j.endedAt) - Number(j.startedAt);
  const avgSeconds = finished.length ? Math.round(durationSum / finished.length / 1000) : null;
  const successRate = done + failed ? Math.round((done / (done + failed)) * 1000) / 10 : null;

  const sparkOf = (fn) => jobsPerBucket.map(fn);
  const sparklines = {
    running: concurrency.map((p) => p.v),
    done: sparkOf((b) => b.done),
    failed: sparkOf((b) => b.failed),
    successRate: sparkOf((b) => (b.done + b.failed ? Math.round((b.done / (b.done + b.failed)) * 100) : 0)),
    tokens: sparkOf((b) => b.tokens),
    avgSeconds: jobsPerBucket.map((b) => {
      const list = inRange.filter((j) => bucketIndex(Number(j.startedAt)) === bucketIndex(b.t));
      const fin = list.filter((j) => Number(j.endedAt) >= Number(j.startedAt));
      if (!fin.length) return 0;
      const avg = fin.reduce((s, j) => s + (Number(j.endedAt) - Number(j.startedAt)), 0) / fin.length;
      return Math.round(avg / 1000);
    }),
  };

  // recentEvents
  const recentEvents = [];
  for (const j of inRange) {
    const base = {
      jobId: j.id,
      name: j.name || j.id,
      project: basename(j.dir) || "(không rõ)",
      model: j.model || null,
      status: j.status || "lost",
      rating: j.rating || null,
      tokens: Number(j.tokens) || 0,
    };
    const st = Number(j.startedAt);
    const en = Number(j.endedAt);
    if (Number.isFinite(st) && st >= win.from) {
      recentEvents.push({ ...base, id: j.id + "-start", type: "start", at: st });
    }
    if (Number.isFinite(en) && en >= win.from) {
      recentEvents.push({ ...base, id: j.id + "-end", type: FAIL_STATUSES.has(j.status) ? "failed" : "done", at: en });
      if (j.rating) recentEvents.push({ ...base, id: j.id + "-rate", type: "rated", at: en + 1 });
    }
  }
  recentEvents.sort((a, b) => b.at - a.at);

  return {
    range,
    from: win.from,
    to: now,
    bucketMs: win.bucketMs,
    mode: win.mode,
    jobsPerBucket,
    statusCounts,
    tokensByModel,
    jobsByModel,
    durationsByKind,
    concurrency,
    kpis: {
      running: runningJobs.length,
      done,
      failed,
      successRate,
      tokens,
      avgSeconds,
    },
    sparklines,
    recentEvents: recentEvents.slice(0, 30),
  };
}

function getMetrics(range) {
  const key = ["today", "24h", "7d"].includes(range) ? range : "24h";
  const hit = metricsCache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.data;
  let data;
  try { data = buildMetrics(key); } catch {
    data = {
      range: key, from: Date.now(), to: Date.now(), bucketMs: 3600_000, mode: "hour",
      jobsPerBucket: [], statusCounts: {}, tokensByModel: [], jobsByModel: [],
      durationsByKind: [], concurrency: [],
      kpis: { running: 0, done: 0, failed: 0, successRate: null, tokens: 0, avgSeconds: null },
      sparklines: { running: [], done: [], failed: [], successRate: [], tokens: [], avgSeconds: [] },
      recentEvents: [],
    };
  }
  metricsCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------- http ----------
function sendJSON(res, status, obj) {
  let body;
  try { body = JSON.stringify(obj); } catch { body = '{"error":"serialize failed"}'; }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  const body = Buffer.from(String(text ?? ""), "utf8");
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Length": body.length,
  });
  res.end(body);
}

function sendHTML(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendFile(res, file, type) {
  let data;
  try { data = fs.readFileSync(file); } catch { return sendJSON(res, 500, { error: "cannot read " + path.basename(file) }); }
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": data.length });
  res.end(data);
}

// CSRF guard for every POST: custom header, local Host, and matching Origin when sent.
function csrfOk(req) {
  if (String(req.headers["x-oc-action"] || "") !== "1") return false;
  const host = String(req.headers.host || "").toLowerCase();
  const allowed = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!allowed.includes(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    let oh = "";
    try { oh = new URL(String(origin)).host.toLowerCase(); } catch { return false; }
    if (oh !== host) return false;
  }
  return true;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function errorStatus(e) {
  if (e instanceof OcError) return 404;
  const msg = String(e?.message || "");
  if (/no job matches|no jobs yet|not found/i.test(msg)) return 404;
  return 500;
}

// Dashboard preferences (theme, language, sidebar, refresh...) are kept server-side as well as in localStorage:
// some browsers clear site data when the window closes, which reset every setting on each launch.
const PREFS_FILE = path.join(process.env.MAESTRO_DATA || SKILL_DIR, "ui-prefs.json");
const PREF_KEY_RE = /^oc-[a-z0-9_-]{1,40}$/;
function loadPrefs() {
  try { const p = JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")); return p && typeof p === "object" ? p : {}; } catch { return {}; }
}
function prefsBootScript() {
  const json = JSON.stringify(loadPrefs()).replace(/</g, "\\u003c");
  return "<script>(function(){var P=" + json + ";try{for(var k in P)localStorage.setItem(k,P[k])}catch(e){}" +
    "window.ocSyncPref=function(k,v){try{fetch('/api/prefs',{method:'POST',headers:{'Content-Type':'application/json','X-OC-Action':'1'}," +
    "body:JSON.stringify({key:k,value:v})})}catch(e){}}})();</script>";
}

async function handlePost(req, res, pathname) {
  if (!csrfOk(req)) {
    return sendJSON(res, 403, { ok: false, message: "CSRF check failed: send X-OC-Action: 1 from the dashboard origin" });
  }

  if (pathname === "/api/prefs") {
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return sendJSON(res, 400, { ok: false, message: "invalid JSON body" }); }
    const key = body && body.key, value = body && body.value;
    if (!PREF_KEY_RE.test(String(key)) || key === "oc-notifications" || typeof value !== "string" || value.length > 2000) {
      return sendJSON(res, 400, { ok: false, message: "invalid preference" });
    }
    const prefs = loadPrefs();
    prefs[key] = value;
    try { fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2)); }
    catch (e) { return sendJSON(res, 500, { ok: false, message: e.message }); }
    return sendJSON(res, 200, { ok: true });
  }

  let m = /^\/api\/job\/([^/]+)\/stop$/.exec(pathname);
  if (m) {
    const id = safeId(m[1]);
    if (!id) return sendJSON(res, 400, { ok: false, message: "invalid job id" });
    try {
      const messages = stopJob(id);
      return sendJSON(res, 200, { ok: true, message: Array.isArray(messages) ? messages.join("; ") : String(messages) });
    } catch (e) {
      return sendJSON(res, errorStatus(e), { ok: false, message: e?.message || "stop failed" });
    }
  }

  for (const action of ["pause", "resume"]) {
    m = new RegExp("^/api/job/([^/]+)/" + action + "$").exec(pathname);
    if (m) {
      const id = safeId(m[1]);
      if (!id) return sendJSON(res, 400, { ok: false, message: "invalid job id", error: "invalid job id" });
      try {
        const message = String(action === "pause" ? pauseJob(id) : resumeJob(id));
        return sendJSON(res, 200, { ok: true, message });
      } catch (e) {
        return sendJSON(res, e instanceof OcError ? 409 : errorStatus(e),
          { ok: false, message: e?.message || action + " failed", error: e?.message || action + " failed" });
      }
    }
  }

  for (const action of ["pause", "resume"]) {
    m = new RegExp("^/api/batch/([^/]+)/" + action + "$").exec(pathname);
    if (m) {
      let ref = m[1];
      try { ref = decodeURIComponent(ref); } catch { /* keep raw */ }
      try {
        const message = String(action === "pause" ? pauseBatch(ref) : resumeBatch(ref));
        return sendJSON(res, 200, { ok: true, message });
      } catch (e) {
        return sendJSON(res, e instanceof OcError ? 409 : errorStatus(e),
          { ok: false, message: e?.message || action + " failed", error: e?.message || action + " failed" });
      }
    }
  }

  m = /^\/api\/job\/([^/]+)\/rate$/.exec(pathname);
  if (m) {
    const id = safeId(m[1]);
    if (!id) return sendJSON(res, 400, { ok: false, message: "invalid job id" });
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJSON(res, 400, { ok: false, message: "invalid JSON body" });
    }
    const verdict = body && body.verdict;
    if (verdict !== "good" && verdict !== "bad") {
      return sendJSON(res, 400, { ok: false, message: 'verdict must be "good" or "bad"' });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
    try {
      const job = await rateJob(id, verdict, note);
      return sendJSON(res, 200, { ok: true, message: `đã đánh giá ${job.id} là ${verdict}` });
    } catch (e) {
      return sendJSON(res, errorStatus(e), { ok: false, message: e?.message || "rate failed" });
    }
  }

  m = /^\/api\/provider\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    const id = safeId(m[1]);
    if (!id || !PROVIDERS.some((p) => p.id === id)) {
      return sendJSON(res, 400, { ok: false, error: "unknown or invalid provider" });
    }
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return sendJSON(res, 400, { ok: false, error: "invalid JSON body" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJSON(res, 400, { ok: false, error: "body must be an object" });
    }
    const patch = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return sendJSON(res, 400, { ok: false, error: "enabled must be boolean" });
      }
      patch.enabled = body.enabled;
    }
    if (body.budgetUsd !== undefined) {
      const b = Number(body.budgetUsd);
      if (!Number.isFinite(b) || b < 0 || b > 1000) {
        return sendJSON(res, 400, { ok: false, error: "budget must be 0..1000 USD per day" });
      }
      patch.budgetUsd = b;
    }
    if (patch.enabled === undefined && patch.budgetUsd === undefined) {
      return sendJSON(res, 400, { ok: false, error: "no valid fields provided" });
    }
    try {
      saveProviderSetting(id, patch);
      const updated = getProviderObject(id);
      return sendJSON(res, 200, updated);
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: e.message });
    }
  }

  return sendJSON(res, 404, { ok: false, message: "not found" });
}

const STATIC_FILES = {
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/charts.js": ["charts.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/intro.js": ["intro.js", "text/javascript; charset=utf-8"],
  "/intro.css": ["intro.css", "text/css; charset=utf-8"],
  "/fox.png": ["fox.png", "image/png"],
  "/fox-avatar.png": ["fox-avatar.png", "image/png"],
  "/fox-full.webp": ["fox-full.webp", "image/webp"],
  "/favicon.ico": ["fox.png", "image/png"],
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url || "/", "http://127.0.0.1"); } catch { return sendJSON(res, 400, { error: "bad url" }); }
  const pathname = url.pathname;

  if (req.method === "POST") {
    try { return await handlePost(req, res, pathname); }
    catch (e) { try { sendJSON(res, 500, { ok: false, message: e?.message || "internal error" }); } catch {} return; }
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJSON(res, 405, { error: "method not allowed" });
  }

  try {
    if (pathname === "/" || pathname === "/intro" || pathname === "/intro.html") {
      if (url.searchParams.has("skip")) { res.writeHead(302, { Location: "/app" }); return res.end(); }
      return sendFile(res, path.join(WEB_DIR, "intro.html"), "text/html; charset=utf-8");
    }
    if (pathname === "/app" || pathname === "/index.html") {
      let html;
      try { html = fs.readFileSync(INDEX_FILE, "utf8"); } catch { return sendJSON(res, 500, { error: "web/index.html not found" }); }
      // Restore saved preferences into localStorage before i18n.js / app.js read them.
      return sendHTML(res, html.replace(/<head>/i, (h) => h + prefsBootScript()));
    }

    if (Object.prototype.hasOwnProperty.call(STATIC_FILES, pathname)) {
      const spec = STATIC_FILES[pathname];
      if (!spec) { res.writeHead(204); return res.end(); }
      return sendFile(res, path.join(WEB_DIR, spec[0]), spec[1]);
    }

    if (pathname === "/api/state") {
      const state = await statePayload();
      return sendJSON(res, 200, state);
    }

    if (pathname === "/api/batches") {
      let batches = [];
      try { batches = allBatches().slice(0, 15); } catch { batches = []; }
      return sendJSON(res, 200, batches);
    }

    if (pathname === "/api/timeline") {
      return sendJSON(res, 200, timelinePayload(url.searchParams.get("hours")));
    }

    if (pathname === "/api/metrics") {
      return sendJSON(res, 200, getMetrics(url.searchParams.get("range") || "24h"));
    }

    if (pathname === "/api/models") {
      return sendJSON(res, 200, getModels());
    }

    if (pathname === "/api/providers" || pathname === "/api/providers/") {
      return sendJSON(res, 200, { providers: listProviders() });
    }

    if (pathname === "/api/health") {
      const raced = await Promise.race([
        getOpencodeVersion(),
        new Promise((r) => setTimeout(() => r(versionValue), 4000)),
      ]);
      let modelCount = 0;
      try { modelCount = (availableModels() || []).length; } catch { modelCount = 0; }
      return sendJSON(res, 200, {
        opencodeVersion: raced || null,
        models: modelCount,
        jobsDir: JOBS,
        maxParallel: MAX_PARALLEL,
        nodeVersion: process.version,
        uptime: Math.round(process.uptime()),
        cores: os.cpus().length || 1,
        memFreeMb: Math.round(os.freemem() / 1048576),
        memTotalMb: Math.round(os.totalmem() / 1048576),
        cpuBusy: cpuBusy(),
      });
    }

    let m = /^\/api\/job\/([^/]+)\/brief$/.exec(pathname);
    if (m) {
      const id = safeId(m[1]);
      if (!id) return sendText(res, 400, "invalid job id");
      const folder = jobFolder(id);
      if (!folder) return sendText(res, 404, "job not found");
      const file = path.join(folder, "brief.md");
      if (!fs.existsSync(file)) return sendText(res, 404, "no brief.md for this job");
      let text;
      try { text = fs.readFileSync(file, "utf8"); } catch { return sendText(res, 500, "cannot read brief.md"); }
      return sendText(res, 200, text);
    }

    m = /^\/api\/job\/([^/]+)$/.exec(pathname);
    if (m) {
      const id = safeId(m[1]);
      if (!id) return sendJSON(res, 400, { error: "invalid job id" });
      const folder = jobFolder(id);
      if (!folder) return sendJSON(res, 404, { error: "job not found" });
      const job = readJSON(path.join(folder, "job.json"), null);
      if (!job) return sendJSON(res, 500, { error: "job.json is missing or unreadable" });
      return sendJSON(res, 200, job);
    }

    m = /^\/api\/log\/([^/]+)$/.exec(pathname);
    if (m) {
      const id = safeId(m[1]);
      if (!id) return sendJSON(res, 400, { error: "invalid job id" });
      const folder = jobFolder(id);
      if (!folder) return sendJSON(res, 404, { error: "job not found" });
      const logFile = path.join(folder, "job.log");
      if (!fs.existsSync(logFile)) return sendJSON(res, 404, { error: "no log for this job" });
      const n = Math.min(2000, Math.max(1, Number(url.searchParams.get("lines")) || 300));
      let text = "";
      try { text = tailText(logFile); } catch { return sendJSON(res, 500, { error: "cannot read job.log" }); }
      const lines = text.trimEnd().split(/\r?\n/);
      const body = lines.slice(-n).join("\n");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(body);
    }

    return sendJSON(res, 404, { error: "not found" });
  } catch (e) {
    try { sendJSON(res, 500, { error: e?.message || "internal error" }); } catch {}
  }
});

function openBrowser(url) {
  try {
    if (IS_WIN) spawn("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

server.on("error", (e) => {
  console.error(`dash-web: ${e.code === "EADDRINUSE" ? `port ${PORT} is already in use` : e.message}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`dash-web: ${url}  (127.0.0.1 only)`);
  if (OPEN) openBrowser(url);
  setImmediate(() => {
    try { getRanking(); } catch {}
    try { getOpencodeVersion(); } catch {}
  });
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
