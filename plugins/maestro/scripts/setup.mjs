import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const TOOL_DIR = path.resolve(PLUGIN_ROOT, "skills/maestro");

const homeDir = process.env.HOME || process.env.USERPROFILE || "";
const DATA_DIR = process.env.MAESTRO_DATA ? path.resolve(process.env.MAESTRO_DATA) : path.join(os.homedir(), ".claude-studio", "maestro");

const npmGlobalBin = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", shell: process.platform === "win32" })
  .stdout?.trim() || "";
const isWindows = process.platform === "win32";
const binDir = isWindows ? npmGlobalBin : path.join(npmGlobalBin, "bin");

const OC_CMD_WIN = path.join(binDir, "oc.cmd");
const MAESTRO_CMD_WIN = path.join(binDir, "maestro.cmd");
const OC_SH = path.join(binDir, "oc");
const MAESTRO_SH = path.join(binDir, "maestro");

// Data dir setup: mkdir -p
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed models.json if missing
const dataModels = path.join(DATA_DIR, "models.json");
const seedModels = path.join(TOOL_DIR, "models.json");
if (!fs.existsSync(dataModels) && fs.existsSync(seedModels)) {
  fs.copyFileSync(seedModels, dataModels);
}

// Plan helper
function plan(text) {
  console.log(text);
}

// ✔/✘ check helper
function check(condition, hint) {
  plan(`  ${condition ? "✔" : "✘"} ${hint}`);
}

// Node version check
const nodeVersion = Number(process.version?.slice(1).split(".")[0] || "0");
check(nodeVersion >= 20, `Node >= 20 (current: ${process.version})`);

// opencode on PATH
const opencodeExists = spawnSync("opencode", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
check(opencodeExists, `opencode on PATH (hint: npm i -g opencode-ai)`);

// Optional agents
const ollamaExists = spawnSync("ollama", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
check(ollamaExists, "Ollama (optional)");

const claudeExists = spawnSync("claude", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
check(claudeExists, "Claude CLI (optional)");

const codexExists = spawnSync("codex", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
check(codexExists, "Codex CLI (optional)");

// === Create Windows cmd files ===
function createCmdFile(filepath, content) {
  if (fs.existsSync(filepath)) {
    const existing = fs.readFileSync(filepath, "utf8");
    if (!existing.includes("oc.mjs")) {
      plan(`  [warn] ${filepath} exists and does not mention "oc.mjs"; skipping overwrite`);
      return;
    }
  }
  fs.writeFileSync(filepath, content);
  // chmod not applicable for .cmd files on Windows, but let's try
  try { fs.chmodSync(filepath, 0o644); } catch {}
  plan(`  created: ${filepath}`);
}

// === Create POSIX sh scripts ===
function createShScript(filepath, content, isMaestro) {
  if (fs.existsSync(filepath)) {
    const existing = fs.readFileSync(filepath, "utf8");
    if (!existing.includes("oc.mjs")) {
      plan(`  [warn] ${filepath} exists and does not mention "oc.mjs"; skipping overwrite`);
      return;
    }
  }
  fs.writeFileSync(filepath, content.startsWith("#!") ? content : `#!/bin/sh\n${content}\n`);
  try { fs.chmodSync(filepath, 0o755); } catch {}
  plan(`  created: ${filepath}`);
}

// === Create OC command ===

// POSIX oc sh script: MAESTRO_DATA=... exec node ".../oc.mjs" "$@"
const ocShContent = `MAESTRO_DATA="${DATA_DIR}" exec node "${path.join(TOOL_DIR, "oc.mjs")}" "$@"`;
createShScript(OC_SH, ocShContent, false);
// Windows oc.cmd
createCmdFile(OC_CMD_WIN, `@echo off
set "MAESTRO_DATA=${DATA_DIR}"
node "${path.join(TOOL_DIR, "oc.mjs")}" %*
`);

// === Create Maestro command ===

// POSIX maestro sh script:
// - no arguments or "open" or "dashboard" -> run launch-app.mjs
// - otherwise -> run oc.mjs with args
// MAESTRO_DATA=... exec node ".../oc.mjs" "$@"
// (oc.mjs itself routes open/dashboard/close/status/restart to launch-app.mjs)
const maestroShContent=`if [ "$1" = "" ]; then
  MAESTRO_DATA="${DATA_DIR}" exec node "${path.join(TOOL_DIR, "launch-app.mjs")}"
else
  MAESTRO_DATA="${DATA_DIR}" exec node "${path.join(TOOL_DIR, "oc.mjs")}" "$@"
fi`;
createShScript(MAESTRO_SH, maestroShContent, true);

// Windows maestro cmd file: @echo off + set "MAESTRO_DATA=<data>" + node "<tool dir>/oc.mjs" %*
// and the same no-argument/open/dashboard branch that runs launch-app.mjs
const maestroCmdContent = `@echo off
set "MAESTRO_DATA=${DATA_DIR}"
if "%~1"=="" (
  node "${path.join(TOOL_DIR, "launch-app.mjs")}"
) else (
  node "${path.join(TOOL_DIR, "oc.mjs")}" %*
)`;
createCmdFile(MAESTRO_CMD_WIN, maestroCmdContent);

// ========================================
// Summary
// ========================================
plan("\n=== Setup complete ===");
plan("Next: run `maestro` to open the dashboard, `maestro doctor` to check agents");