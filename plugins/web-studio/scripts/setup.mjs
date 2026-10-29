#!/usr/bin/env node
// web-studio first-run setup: checks the tools the workflow needs and installs the crawler's dependencies.
// Usage: node <web-studio>/scripts/setup.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOUT = path.join(ROOT, "skills", "ui-template-picker", "scout");
const DATA = process.env.WEB_STUDIO_DATA || path.join(os.homedir(), ".claude-studio", "scout");
const isWin = process.platform === "win32";

const has = (cmd) => spawnSync(isWin ? "where" : "which", [cmd], { stdio: "ignore", shell: isWin }).status === 0;
const ok = (b, label, hint = "") => console.log(`${b ? "✔" : "✘"} ${label}${!b && hint ? `  ->  ${hint}` : ""}`);

const [major] = process.versions.node.split(".").map(Number);
ok(major >= 20, `Node.js ${process.versions.node}`, "install Node.js 20 or newer");
ok(has("pnpm"), "pnpm (used by scaffold.sh)", "npm i -g pnpm");
ok(has("bash"), "bash (scaffold.sh)", isWin ? "install Git for Windows (it ships bash)" : "");
ok(has("maestro") || has("oc"), "Maestro command (coding agents)", "install the maestro plugin from this marketplace and run its setup");

const browsers = isWin
  ? [path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
     path.join(process.env.ProgramFiles || "", "Google/Chrome/Application/chrome.exe")]
  : process.platform === "darwin"
    ? ["/Applications/Microsoft Edge.app", "/Applications/Google Chrome.app"]
    : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
ok(browsers.some((b) => fs.existsSync(b)), "Edge or Chrome (template crawler)", "install Microsoft Edge or Google Chrome");

console.log("\nInstalling crawler dependencies (playwright-core, sharp)...");
const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "playwright-core", "sharp"],
  { cwd: SCOUT, stdio: "inherit", shell: isWin });
ok(r.status === 0, "crawler dependencies installed", "run the npm command above manually in " + SCOUT);

fs.mkdirSync(DATA, { recursive: true });
console.log(`\nData folder: ${DATA}`);
console.log(`Next: crawl the template sources once (takes a few minutes):\n  node "${path.join(SCOUT, "scout.mjs")}" update`);
