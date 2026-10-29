#!/usr/bin/env node
// Maestro dashboard as a background app:
//   maestro            (or `maestro open` / `maestro dashboard`) start the server hidden if needed, open the app window
//   maestro close      stop the background server (open app windows then show "offline")
//   maestro status     is it running, where, since when
// The server runs with no console window (so it cannot be closed by accident); its output goes to a log file.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.MAESTRO_PORT || 4790);
const url = `http://localhost:${port}`;
const RUN_DIR = process.env.OC_JOBS_DIR || path.join(os.tmpdir(), "opencode-jobs");
const PID_FILE = path.join(RUN_DIR, ".dashboard.pid");
const LOG_FILE = path.join(RUN_DIR, "dashboard.log");
const IS_WIN = process.platform === "win32";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

function readPid() {
  try { return JSON.parse(fs.readFileSync(PID_FILE, "utf8")); } catch { return null; }
}

function openWindow() {
  if (IS_WIN) {
    spawn("cmd", ["/c", "start", "", "msedge", `--app=${url}`, "--window-size=1440,900"],
      { stdio: "ignore", windowsHide: true, detached: true }).unref();
  } else {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }
}

function startServer() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const out = fs.openSync(LOG_FILE, "a");
  // detached + windowsHide: no console window at all, and the server outlives this command.
  const child = spawn(process.execPath, [path.join(DIR, "dash-web.mjs"), "--port", String(port)], {
    detached: true, windowsHide: true, stdio: ["ignore", out, out],
  });
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port, started: Date.now() }));
  child.unref();
}

// Kill every dashboard server (also ones started the old way with `oc web`), not only the recorded pid.
function stopServers() {
  const rec = readPid();
  if (IS_WIN) {
    spawnSync("powershell", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dash-web.mjs*' -or $_.CommandLine -like '*oc.mjs* web*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
      { windowsHide: true });
  } else {
    spawnSync("pkill", ["-f", "dash-web.mjs"]);
  }
  if (rec?.pid) { try { process.kill(rec.pid); } catch {} }
  try { fs.rmSync(PID_FILE, { force: true }); } catch {}
}

const cmd = process.argv[2] || "open";

if (cmd === "close" || cmd === "stop") {
  if (!(await up()) && !readPid()) { console.log("Maestro: không chạy."); process.exit(0); }
  stopServers();
  for (let i = 0; i < 20 && (await up()); i++) await sleep(250);
  console.log((await up()) ? "Maestro: chưa tắt được, thử lại." : "Maestro: đã tắt.");
} else if (cmd === "status") {
  const rec = readPid();
  if (await up()) {
    const since = rec?.started ? `, chạy từ ${new Date(rec.started).toLocaleString()}` : "";
    console.log(`Maestro: đang chạy ${url}${rec?.pid ? ` (pid ${rec.pid})` : ""}${since}. Log: ${LOG_FILE}`);
  } else {
    console.log("Maestro: không chạy. Mở bằng: maestro");
  }
} else if (cmd === "restart") {
  stopServers();
  for (let i = 0; i < 20 && (await up()); i++) await sleep(250);
  startServer();
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
  console.log((await up()) ? `Maestro: đã khởi động lại ${url}` : `Maestro: không khởi động được, xem ${LOG_FILE}`);
} else {
  const running = await up();
  if (!running) {
    startServer();
    for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
    if (!(await up())) { console.log(`Maestro: server không lên, xem ${LOG_FILE}`); process.exit(1); }
  }
  openWindow();
  console.log(`Maestro: ${url}${running ? "" : "  (đã chạy ngầm; tắt bằng: maestro close)"}`);
}
