// Replace personal paths / old names in the web-studio copy of the skills (repo C:\claude-studio).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.argv[2];
// The example project lived in the author's Downloads folder; its absolute path is replaced by a placeholder.
const EXAMPLE_DIR = path.join(os.homedir(), "Downloads", "coffee").replace(/\\/g, "/");
const rules = [
  ["`node ~/.claude/skills/ui-template-picker/scout/scout.mjs`", '`node "$WEB_STUDIO/skills/ui-template-picker/scout/scout.mjs"`'],
  ["node ~/.claude/skills/ui-template-picker/scout/", 'node "$WEB_STUDIO/skills/ui-template-picker/scout/'],
  ["~/.claude/skills/ui-template-picker/", "$WEB_STUDIO/skills/ui-template-picker/"],
  ["~/.claude/skills/premium-motion/", "$WEB_STUDIO/skills/premium-motion/"],
  ["`bash ~/.claude/skills/design-web/scripts/scaffold.sh", '`bash "$WEB_STUDIO/skills/design-web/scripts/scaffold.sh"'],
  ["Talk to the user in Vietnamese.", "Talk to the user in their language."],
  ["(`delegate-opencode` skill)", "(Maestro plugin, `maestro` command)"],
  ["## Phase 7 - Build in waves (delegate-opencode)", "## Phase 7 - Build in waves (Maestro)"],
  ["`(node oc.mjs batch plan.json < /dev/null > log 2>&1 &)`", "`(maestro batch plan.json < /dev/null > log 2>&1 &)`"],
  ["open the web dashboard (`oc web --open`, see delegate-opencode)", "open the Maestro dashboard (`maestro web --app`)"],
  ["### 6. Hand off to implementation (delegate-opencode)", "### 6. Hand off to implementation (Maestro)"],
  ["In delegate-opencode plans,", "In Maestro plans,"],
  ["- `~/.claude/skills/gsap-scrolltrigger/SKILL.md` -> `design/ref-gsap-scrolltrigger.md`",
   "- the `gsap-scrolltrigger` skill (if installed: its SKILL.md) -> `design/ref-gsap-scrolltrigger.md`"],
  [`"${EXAMPLE_DIR}"`, '"C:/path/to/your-project"'],
  [`import * as m from "${EXAMPLE_DIR}/src/lib/mock/index.ts";`,
   '// Data-integrity check for the mock data of a /design-web project (run with: npx tsx check-mock.ts).\nimport * as m from "./src/lib/mock/index.ts";'],
  ["`oc` picks", "Maestro picks"],
  ["(`oc web", "(`maestro web"],
  ["oc rate", "maestro rate"],
];

let changed = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(md|json|ts|mjs|sh|html)$/.test(e.name)) continue;
    let s = fs.readFileSync(p, "utf8");
    const before = s;
    for (const [a, b] of rules) s = s.split(a).join(b);
    if (s !== before) { fs.writeFileSync(p, s); changed++; console.log("updated", path.relative(root, p)); }
  }
};
walk(root);
console.log(`${changed} files updated`);
