// Adaptive concurrency limits for Maestro (oc.mjs).
// Decides whether one more job may start now, from the machine's capacity and the jobs already running:
//   - total jobs: OC_MAX_PARALLEL, else half the CPU cores (2..8), held back when RAM or CPU is short;
//   - per cloud model: OC_MAX_PER_MODEL (default 2) - free endpoints rate-limit bursts from one client;
//   - local models (ollama/*): OC_MAX_LOCAL (default 1) for all of them together - they share one GPU/CPU.
import os from "node:os";

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? Number(process.env[k]) : d);
const isLocal = (model) => /^ollama\//.test(String(model || ""));

// CPU busy share over a short window (os.loadavg() is always 0 on Windows).
let cpuCache = { at: 0, busy: 0 };
function sampleCpu() {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
  const a = snap();
  const until = Date.now() + 250;
  while (Date.now() < until) { /* short busy wait: keeps this function synchronous */ }
  const b = snap();
  const total = b.total - a.total;
  return total > 0 ? 1 - (b.idle - a.idle) / total : 0;
}
function cpuBusy() {
  if (Date.now() - cpuCache.at > 5000) cpuCache = { at: Date.now(), busy: sampleCpu() };
  return cpuCache.busy;
}

export function machineLimits() {
  const cores = os.cpus().length || 2;
  return {
    cores,
    maxTotal: env("OC_MAX_PARALLEL", Math.min(8, Math.max(2, Math.floor(cores / 2)))),
    maxPerModel: env("OC_MAX_PER_MODEL", 2),
    maxLocal: env("OC_MAX_LOCAL", 1),
    minFreeMb: env("OC_MIN_FREE_MB", 1500),
    maxCpu: env("OC_MAX_CPU", 0.85),
  };
}

// running: job records with status "running" (from allJobs()); model: the model the new job would use.
// Returns { ok, reason } - reason is shown to the user while a job waits.
export function canStart(running, model) {
  const L = machineLimits();
  const active = running.filter((j) => !j.paused);
  if (active.length >= L.maxTotal) return { ok: false, reason: `đủ ${L.maxTotal} job chạy cùng lúc (máy ${L.cores} nhân)` };
  if (isLocal(model)) {
    const local = active.filter((j) => isLocal(j.model)).length;
    if (local >= L.maxLocal) return { ok: false, reason: `model chạy trên máy đang bận (${local}/${L.maxLocal})` };
  } else if (model) {
    const same = active.filter((j) => j.model === model).length;
    if (same >= L.maxPerModel) return { ok: false, reason: `${String(model).replace(/^opencode\//, "")} đang chạy ${same} job` };
  }
  if (active.length > 0) {
    const freeMb = Math.round(os.freemem() / 1048576);
    if (freeMb < L.minFreeMb) return { ok: false, reason: `RAM trống còn ${freeMb} MB` };
    const busy = cpuBusy();
    if (busy > L.maxCpu) return { ok: false, reason: `CPU đang bận ${Math.round(busy * 100)}%` };
  }
  return { ok: true, reason: "" };
}

// For pickers: how many more jobs this model may take right now (Infinity when no per-model cap applies).
export function modelHeadroom(running, model) {
  const L = machineLimits();
  const active = running.filter((j) => !j.paused);
  if (isLocal(model)) return Math.max(0, L.maxLocal - active.filter((j) => isLocal(j.model)).length);
  return Math.max(0, L.maxPerModel - active.filter((j) => j.model === model).length);
}
