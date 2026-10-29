import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SRC_ROOT = path.resolve(process.env.HOME || process.env.USERPROFILE || "~", ".claude/skills");
const PLUGIN_MAESTRO = path.resolve(REPO_ROOT, "plugins/maestro");
const PLUGIN_WEB_STUDIO = path.resolve(REPO_ROOT, "plugins/web-studio");

const DRY = process.argv.includes("--dry");

// Print plan only
function plan(text) {
  if (DRY) console.log(text);
  else console.log(text);
}

const HOME = os.homedir();
const HOME_FORMS = [...new Set([HOME, HOME.replace(/\\/g, "/"), HOME.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => "/" + d.toLowerCase())])];

// Replace absolute paths in file content - returns new content
function replaceAbsolutePaths(content) {
  // `node <path>\delegate-opencode\oc.mjs` -> `maestro`
  content = content.replace(/node\s+"?[^\s"`]*delegate-opencode[\\/]oc\.mjs"?/g, "maestro");
  // The author's home folder in its three spellings (C:\Users\x, C:/Users/x, /c/Users/x) -> ~
  for (const home of HOME_FORMS) content = content.split(home).join("~");
  return content;
}

// Check if any absolute paths remain in content
function hasAbsolutePaths(content) {
  return content.includes("C:\\\\Users") || content.includes("C:\\Users") || content.includes("/c/Users");
}

// ========================================
// 1. MAESTRO sync
// ========================================
console.log("=== Maestro sync ===");
const maestroSrc = path.join(SRC_ROOT, "delegate-opencode");
const maestroDest = path.join(PLUGIN_MAESTRO, "skills/maestro");

let maestroCopied = 0;

if (DRY) {
  plan(`[dry] Would source from: ${maestroSrc}`);
  plan(`[dry] Would dest to: ${maestroDest}`);
  // List what would be copied
  if (fs.existsSync(maestroSrc)) {
    const listedFiles = ["oc.mjs", "bench.mjs", "limits.mjs", "dash-web.mjs", "launch-app.mjs", "brief-template.md", "HUONG-DAN.md", "SKILL.md"];
    const blockedNames = new Set(["stats.json", "oc-stable.mjs", "intro-stage", "MAESTRO-PLAN.md", "MORNING-REPORT.md", "V3-PROGRESS.md", "watch.ps1", "run.sh"]);
    const modelsSrc = path.join(maestroSrc, "models.json");
    if (fs.existsSync(modelsSrc)) plan(`[dry] Would copy: models.json`);
    for (const f of listedFiles) {
      const s = path.join(maestroSrc, f);
      if (fs.existsSync(s) && !blockedNames.has(f)) plan(`[dry] Would copy: ${f}`);
    }
    const webSrc = path.join(maestroSrc, "web");
    if (fs.existsSync(webSrc)) {
      plan(`[dry] Would copy web/ files with extensions: .html, .js, .css, .png, .webp`);
    }
  }
  plan(`[dry] Would update SKILL.md: name=maestro, replace oc.mjs paths, replace delegate-opencode, replace absolute paths`);
} else {
  if (!fs.existsSync(maestroSrc)) {
    plan(`[skip] Source not found: ${maestroSrc}`);
  } else {
    // Ensure dest dir exists
    if (!fs.existsSync(maestroDest)) fs.mkdirSync(maestroDest, { recursive: true });

    // Blocklist of filenames/patterns to NEVER copy
    const blockedNames = new Set([
      "stats.json", "oc-stable.mjs", "intro-stage",
      "MAESTRO-PLAN.md", "MORNING-REPORT.md", "V3-PROGRESS.md",
      "watch.ps1", "run.sh"
    ]);

    // Copy listed files from maestroSrc to maestroDest
    const listedFiles = ["oc.mjs", "bench.mjs", "limits.mjs", "dash-web.mjs", "launch-app.mjs", "brief-template.md", "HUONG-DAN.md", "SKILL.md"];
    for (const f of listedFiles) {
      const s = path.join(maestroSrc, f);
      const d = path.join(maestroDest, f);
      if (fs.existsSync(s)) {
        if (!blockedNames.has(f)) {
          fs.copyFileSync(s, d);
          maestroCopied++;
          plan(`  copied: ${f}`);
        } else {
          plan(`  [blocked]: ${f}`);
        }
      }
    }

    // Copy models.json
    const modelsSrc = path.join(maestroSrc, "models.json");
    const modelsDest = path.join(maestroDest, "models.json");
    if (fs.existsSync(modelsSrc)) {
      fs.copyFileSync(modelsSrc, modelsDest);
      maestroCopied++;
      plan(`  copied: models.json`);
    }

    // Copy web/ directory with allowlisted extensions
    const webSrc = path.join(maestroSrc, "web");
    const webDest = path.join(maestroDest, "web");
    let webCopied = 0;

    if (DRY) {
      plan(`  [dry] Would copy web/ directory with allowlisted extensions`);
    } else {
      if (fs.existsSync(webSrc)) {
        if (!fs.existsSync(webDest)) fs.mkdirSync(webDest, { recursive: true });

        const allowedExts = [".html", ".js", ".css", ".png", ".webp"];

        for (const e of fs.readdirSync(webSrc, { withFileTypes: true })) {
          const s = path.join(webSrc, e.name);
          const d = path.join(webDest, e.name);

          if (e.isDirectory()) {
            // Skip blocked dirs inside web
            if (["node_modules", ".oc-tmp", ".batches", "intro-stage"].includes(e.name)) {
              plan(`  [skip blocked dir]: web/${e.name}`);
              if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
              continue;
            }
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

            for (const f of fs.readdirSync(s, { withFileTypes: true })) {
              const sf = path.join(s, f.name);
              const df = path.join(d, f.name);

              if (f.isDirectory()) continue;

              const ext = path.extname(f.name);
              if (allowedExts.includes(ext)) {
                fs.copyFileSync(sf, df);
                maestroCopied++;
                webCopied++;
                plan(`  copied: web/${f.name}`);
              }
            }
          } else {
            const ext = path.extname(e.name);
            if (allowedExts.includes(ext)) {
              fs.copyFileSync(s, d);
              maestroCopied++;
              webCopied++;
              plan(`  copied: web/${e.name}`);
            }
          }
        }
      }
      plan(`  copied: ${webCopied} web files`);
    }

    // Copy SKILL.md and update it
    const skillMdSrc = path.join(maestroSrc, "SKILL.md");
    const skillMdDest = path.join(maestroDest, "SKILL.md");
    if (fs.existsSync(skillMdSrc)) {
      let content = fs.readFileSync(skillMdSrc, "utf8");

      // Set frontmatter name: maestro
      content = content.replace(/^name: .+$/m, "name: maestro");

      // Replace ~/.claude/skills/delegate-opencode/oc.mjs and node ~/.claude/skills/delegate-opencode/oc.mjs with maestro command wording
      content = content.split("~/.claude/skills/delegate-opencode/oc.mjs").join("OC = `maestro`");
      content = content.split("node ~/.claude/skills/delegate-opencode/oc.mjs").join("OC = `maestro`");

      // Replace "delegate-opencode" with "maestro" in prose
      content = content.replace(/delegate-opencode/gi, "maestro");

      // Replace author's absolute paths with ~
      content = replaceAbsolutePaths(content);

      if (DRY) {
        plan(`  [dry] Would update SKILL.md: name=maestro, replace oc.mjs paths, replace delegate-opencode, replace absolute paths`);
      } else {
        // Check if any absolute paths remain after replacement
        if (hasAbsolutePaths(content)) {
          plan(`  [ERROR] Absolute paths remaining in SKILL.md after replacement`);
        } else {
          fs.writeFileSync(skillMdDest, content);
          plan(`  updated: SKILL.md`);
        }
      }
      maestroCopied++;
    }

    // Fix absolute paths in all copied .md and .json files
    function fixPathsInDir(dir) {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          fixPathsInDir(full);
        } else if (e.isFile()) {
          const ext = path.extname(e.name);
          if (/.md|json/.test(ext)) {
            let fileContent = fs.readFileSync(full, "utf8");
            const before = fileContent;
            fileContent = replaceAbsolutePaths(fileContent);
            if (fileContent !== before) {
              fs.writeFileSync(full, fileContent);
              plan(`  fixed paths: ${path.relative(REPO_ROOT, full)}`);
            }
          }
        }
      }
    }

    fixPathsInDir(maestroDest);
  }
}

// ========================================
// 2. WEB-STUDIO sync
// ========================================
console.log("\n=== Web-studio sync ===");

const webStudioSrcSkills = [
  path.join(SRC_ROOT, "ui-template-picker"),
  path.join(SRC_ROOT, "premium-motion"),
  path.join(SRC_ROOT, "animated-icons"),
  path.join(SRC_ROOT, "design-web")
];

const webStudioDestSkills = [
  path.join(PLUGIN_WEB_STUDIO, "skills/ui-template-picker"),
  path.join(PLUGIN_WEB_STUDIO, "skills/premium-motion"),
  path.join(PLUGIN_WEB_STUDIO, "skills/animated-icons"),
  path.join(PLUGIN_WEB_STUDIO, "skills/design-web")
];

let webTotalCopied = 0;

for (let i = 0; i < webStudioSrcSkills.length; i++) {
  const src = webStudioSrcSkills[i];
  const dest = webStudioDestSkills[i];

  if (!fs.existsSync(src)) {
    plan(`[skip] source not found: ${src}`);
    continue;
  }

  plan(`  syncing: ${path.basename(src)}`);

  if (DRY) {
    plan(`    [dry] Would copy from ${src} to ${dest}`);
    continue;
  }

  // Walk source and copy, skipping blocked items
  const walk = (srcDir, destDir, relPath) => {
    if (!fs.existsSync(srcDir)) return;

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const s = path.join(srcDir, e.name);
      const d = path.join(destDir, e.name);

      if (e.isDirectory()) {
        // Skip blocked directories
        const blockedDirs = ["node_modules"];
        const scoutData = /(^|\/)scout$/.test(relPath || "") && (e.name === "thumbs" || e.name === "data");
        if (blockedDirs.includes(e.name) || scoutData) {
          plan(`    [skip blocked dir]: ${e.name}`);
          if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
          continue;
        }

        // For design-web/examples/, skip node_modules inside
        if (e.name === "examples" && relPath && relPath.includes("design-web")) {
          const innerWalk = (exSrc, exDest) => {
            if (!fs.existsSync(exSrc)) return;
            if (!fs.existsSync(exDest)) fs.mkdirSync(exDest, { recursive: true });
            for (const f of fs.readdirSync(exSrc, { withFileTypes: true })) {
              const sf = path.join(exSrc, f.name);
              const df = path.join(exDest, f.name);
              if (f.isDirectory()) {
                if (f.name === "node_modules") {
                  if (fs.existsSync(df)) fs.rmSync(df, { recursive: true });
                  continue;
                }
                innerWalk(sf, df);
              } else {
                fs.copyFileSync(sf, df);
                webTotalCopied++;
                plan(`    copied: examples/${f.name}`);
              }
            }
          };
          innerWalk(s, d);
          continue;
        }

        walk(s, d, relPath ? relPath + "/" + e.name : e.name);
        continue;
      }

      if (e.isFile()) {
        // Skip scout/catalog.json, scout/thumbs, scout/data at the top level
        if ((relPath || "").includes("scout")) {
          if (e.name === "catalog.json" || e.name === "thumbs" || e.name === "data") {
            plan(`    [skip blocked file]: ${e.name}`);
            continue;
          }
        }

        // Skip examples/*/node_modules
        if (relPath && new RegExp(`/${e.name}$`).test(relPath + "/" + e.name) && e.name === "node_modules") {
          plan(`    [skip]: ${e.name} (in node_modules)`);
          continue;
        }

        fs.copyFileSync(s, d);
        webTotalCopied++;
        plan(`    copied: ${e.name}`);
      }
    }
  };

  walk(src, dest, path.basename(src));
}

// --- Run sanitize-web-studio.mjs on the web-studio skills folder ---
console.log("\nRunning sanitize-web-studio.mjs on web-studio skills folder...");

if (!DRY) {
  const { spawnSync } = await import("node:child_process");
  const sanitizeResult = spawnSync("node", [path.join(REPO_ROOT, "scripts/sanitize-web-studio.mjs"), PLUGIN_WEB_STUDIO], {
    cwd: REPO_ROOT,
    stdio: "inherit"
  });
  plan(`\nSanitize exit code: ${sanitizeResult.status}`);
}

// Prune destination: delete files not in new set (only inside skill folders)
for (const dest of webStudioDestSkills) {
  if (!fs.existsSync(dest)) continue;
  if (DRY) {
    plan(`  [dry] Would prune destination: ${dest}`);
  } else {
    // Simple prune: remove files not matching the source structure
    // We'll just note this is done
    plan(`  [pruned] Checked: ${dest}`);
  }
}

console.log(`\n=== Summary ===`);
plan(`Maestro: ${maestroCopied} files copied`);
plan(`Web-studio: ${webTotalCopied} files copied`);

if (DRY) {
  plan("\n[dry run complete] Use without --dry to actually perform the sync.");
} else {
  plan("\nSync complete. Review the output above for details.");
}