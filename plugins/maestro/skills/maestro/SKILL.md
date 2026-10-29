---
name: maestro
description: Default way to implement code changes - Claude plans, splits the work into jobs, and verifies; opencode writes the code with free models picked automatically per job kind (ranked by a hidden-test bench plus Claude's ratings), automatic fallback when a free model is down, parallel jobs or whole dependency plans (batch), and a live terminal dashboard. Use for any task that edits files (features, fixes, refactors, scripts, config, UI, data/asset changes) unless the user says to do it directly.
---

# Delegate implementation to opencode (v3)

The user wants to save Claude tokens: **Claude plans, controls and verifies; opencode edits.**
Claude does not write the implementation itself, except trivial fixes of a few lines.

One controller does everything: `OC = `maestro`` (Node, no dependencies).
Below, `OC` = `node OC = `maestro``. `OC help` lists all commands.

## 1. Plan (cheaply)

- Read only what is needed to name exact files, functions and acceptance checks. opencode reads the rest.
- Split the work into **jobs**: one concern, a few files, one clear check. Free models do much better on narrow jobs.
- Give every job a **scope** (files/folders it may create or edit). Jobs that can run at the same time in the same
  folder need disjoint scopes.
- Shared files (package manifests, lockfiles, root layout, global CSS, tailwind/vite/next config, shared types) belong to
  exactly one job. Dependency installs go in a **setup** job that runs first.
- Shape: setup -> parallel wave(s) of independent jobs -> integration job -> Claude verifies.

## 2. Choose the kind - the model follows

Give each job a `kind`; `oc` picks the best available free model for it and keeps 2 fallbacks ready.

| kind | Use for | Ranked by bench tasks |
|---|---|---|
| `quick` | small edits, config, copy, renames, boilerplate (speed matters) | fix (+ old smoke) |
| `code` | logic, utilities, APIs, data handling, tests (default) | code + fix |
| `ui` | React/TSX components, styling, motion | ui |
| `hard` | multi-file refactor, tricky bugs, integration jobs | code + fix + ui |

- See the ranking before planning: `OC pick` (all kinds) or `OC pick ui`. Full table: `OC models`.
- Score = quality x reliability, updated by Claude's ratings (`OC rate`). Quality = public benchmark priors
  (models.json `research`, or a family prior for models added with an API key) blended with the hidden-test bench.
  Capability levels 1-5 gate kinds: hard >= 4, code/ui >= 3, quick >= 2. Failed endpoints are skipped for 30 min;
  OpenCode's shared free quota running out skips every opencode model for 3 h.
- Override when you have a reason: `--model provider/model` (fallbacks still apply unless `--fallbacks 0`), `--variant high|max`.
- Do NOT spend model calls on re-benching (the user asked to save quota): rank with research priors; bench only a
  single new model with `OC bench <model> --tasks fix` when the user asks.
- Runners: opencode (free), `antigravity/gemini-*` (Antigravity CLI, free; edits only, no terminal commands, so
  Claude runs the tests), ollama (local, weak), and opt-in (`--paid`): claude/*, codex/*, antigravity Claude/GPT,
  and the user's own API keys.
- API keys: `OC keys` lists providers (OpenAI, Anthropic, Google, OpenRouter, Groq, ...). Keys live in opencode's store
  (`OC keys add <provider>` runs `opencode auth login`); Maestro keeps only on/off and a daily budget
  (`OC keys enable <p> --budget 2`). Paid providers need `--paid` AND a budget, and stop for the day at the budget.
  Never ask the user to paste a key into chat.

## 3. Write briefs

One file per job in the session scratchpad, from `brief-template.md`. First line = title (shown in the dashboard).
Goal + why, exact files (and what must NOT be touched), decisions already made, acceptance checks with exact commands,
and the design spec for UI jobs (quote the relevant part of `design/design-brief.md`; see `ui-template-picker`,
`premium-motion`, `animated-icons`). `oc` appends fixed rules itself (scope, no version-control publishing, no questions,
final summary). Max ~27k characters per brief.

## 4. Show the user the dashboard

The user prefers the **web dashboard**: run `maestro` (no arguments; also `maestro open`) - it starts the server in
the background when http://localhost:4790 does not answer yet and opens the Maestro app window, then returns. Tell the
user the same command opens it again any time - jobs per project with live
logs, model ranking per kind, and running processes (opencode jobs, oc controllers, dev servers, PowerShell windows).
The terminal dashboard is the alternative.
Terminal dashboard (skip if an "opencode jobs" tab is already open):

```
run_in_terminal  command: node ~\.claude\skills\maestro\oc.mjs dash   title: opencode jobs
```

Shows the last 9 jobs (model, kind, status, time, steps, tokens, files, last action; `↻2` = fallback attempt)
and the live log of the newest running job. Keys: `1`-`9` pin a job, `a` follow newest, `m` model ranking, `q` quit.
Link the tab for the user: `[opencode jobs](#terminal/<tab_id>)`.

## 5. Launch

**A whole plan (preferred for 2+ jobs)** - one background Bash call, one notification at the end:

```json
{
  "dir": "C:/path/to/project",
  "defaults": { "kind": "code", "timeout": 900 },
  "jobs": [
    { "name": "setup", "brief": "b-setup.md", "scope": "package.json,app/globals.css,components/motion", "kind": "quick" },
    { "name": "hero", "brief": "b-hero.md", "scope": "components/sections/hero.tsx", "kind": "ui", "after": ["setup"] },
    { "name": "pricing", "brief": "b-pricing.md", "scope": "components/sections/pricing.tsx", "kind": "ui", "after": ["setup"] },
    { "name": "page", "brief": "b-page.md", "scope": "app/page.tsx", "kind": "hard", "after": ["hero", "pricing"] }
  ]
}
```

```bash
node OC = `maestro` batch <scratchpad>/plan.json --dry-run < /dev/null   # waves + chosen models
node OC = `maestro` batch <scratchpad>/plan.json < /dev/null              # run_in_background: true
```
Brief paths are relative to the plan file. Jobs start as soon as their `after` jobs are done; a failed job skips its
dependents. Per-job keys: name, brief, scope, kind, model, fallbacks, timeout, stall, variant, dir, allowExternal.
To check results between waves, split the plan into one plan per wave.

**A single job**:

```bash
OC_QUIET=1 node OC = `maestro` run <brief.md> --dir <project> --scope "a,b" --name hero --kind ui < /dev/null
```
Use `run_in_background: true`; several single jobs can be started in one message. Max 3 run at once (`OC_MAX_PARALLEL`);
extra jobs wait for a free slot (`--no-wait` to refuse instead). Overlapping scopes are refused.

Exit codes: 0 done, 1 failed, 124 timeout, 125 stalled, 126 blocked (permission), 3 refused, 2 usage.
Options: `--timeout 900`, `--stall 300` (kill when silent this long), `--fallbacks 2`, `--agent`, `--force`,
`--allow-external "<glob>"` (only when a job truly needs a folder outside the project, e.g. a sibling package).

Every run is sandboxed by `oc` (no project files needed): paths outside the project are **denied** (the model gets a
refusal and continues), questions are denied, `CI=1` is set so test runners don't start in watch mode, and the model is
told to use relative paths and a per-job scratch folder `.oc-tmp/<job>/` that `oc` deletes afterwards. Global
permission rules (version-control publishing denied) stay in force - verified that the per-run layer merges, not replaces.

## 6. Read the result (cheap)

The run/batch output ends with compact reports. Later: `OC report <id|name|last>` - status, model + attempts,
tokens, tools, files touched, **outside-scope edits**, blocked/denied actions, opencode's final summary.
More only when needed: `OC log <id> --lines 120`, job folder (`events.jsonl`, `debug.log`). Also `OC list`, `OC stop <id>`.

Status `blocked`: opencode hit a permission set to "ask" (from global or project config); `opencode run` cannot ask, so
it was rejected and the session ended. Outside paths and questions no longer cause this (denied per run). If it still
happens, the report names the action: change the brief, or add an allow rule to the project's `opencode.json`
"permission" block. Never use `--auto`.

Status `stalled` on a long job: usually a command that never returns (watch mode, dev server, prompt) or a free provider
stalling mid-stream. With no edits yet, `oc` retries on the next model; otherwise split the job or name the exact
single-run test command in the brief.

## 7. Verify independently - never trust the summary

- "files" in the report = edits through opencode's edit tools + files whose modification time changed inside the
  job's scope while it ran (catches `cat >`/`sed -i` edits). Changes outside the scope that no overlapping job owns are
  reported as `WARNING outside scope`. Still, the working-tree diff is the truth: read-only VCS status/diff
  (stat first, then the files that matter).
- Nothing outside the planned scopes changed; inspect every `WARNING outside scope`.
- Run the acceptance checks yourself (build, typecheck, tests, lint).
- UI: browser/preview tools at desktop + mobile width, motion runs, reduced motion respected, screenshot for the user.

## 8. Rate, then fix

- **Always rate** each verified job - this is how model choice improves over time:
  `OC rate <id> good` or `OC rate <id> bad --note "why"` (rating again replaces the previous one).
- Something wrong -> short self-contained follow-up brief (exact files, exact change, failing command + error lines)
  as a new job; never continue an old session. After 2 failed rounds: try `--kind hard` or another `--model`,
  fix it yourself if trivial, or report it.

## 9. Report

Outcome, jobs (model, status, time), files changed, validation evidence, open risks.
Version-control publishing stays with the user: give them the commands, never run them.

## Known pitfalls (handled by oc.mjs)

- opencode waits forever when stdin is open -> `oc` closes it. Calling `opencode run` by hand: add `< /dev/null`.
- `-f/--file` swallows the words after it -> `oc` passes the brief inline.
- The npm `.cmd` shim mangles multi-line arguments -> `oc` calls `opencode.exe` directly.
- Paths outside `--dir` (including symlinks/junctions pointing outside) are external directories -> denied per run;
  use `--allow-external` for a real need. Seen in practice: models `cd` into a mistyped absolute project path
  (e.g. names with "—" or spaces) or write to `/tmp`; the run rules now forbid both.
- Permission rules use the `bash` key in `~/.config/opencode/opencode.jsonc` (verified enforced on opencode 1.19);
  a project `opencode.json` is merged on top of it.
- opencode has the Motion docs MCP configured, so UI briefs may tell it to search Motion docs.
