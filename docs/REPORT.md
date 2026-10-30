# Project report - claude-studio 0.3.1

Date: 2026-10-29 · Author: foxxiee · Repository: https://github.com/foxxiee04/claude-studio-maestro

## 1. Goal

A personal toolkit for Claude Code, packaged so others can install it:

- **Maestro**: Claude plans and verifies, cheaper or free coding agents write the code. Jobs are routed by difficulty,
  run in parallel within the machine's limits, fall back to another model when a provider fails, and are visible in
  a desktop-style dashboard.
- **web-studio**: pick the look first (real templates crawled into a gallery), then build the site through Maestro.

## 2. What was built

| Area | Result |
|---|---|
| Controller (`oc.mjs`, command `maestro`) | run, batch (dependency waves), pause / resume / stop, rate, pick, models, limits, doctor, bench, open / close / status / restart |
| Runners | opencode, Antigravity CLI (`agy`, Gemini), Ollama, Claude CLI, Codex CLI |
| Routing | capability levels 1-5 per model, minimum level per job kind, free vs opt-in tiers, quotas (Claude 6, Codex 8 jobs per 5 h), load spreading, exploration of untested models |
| Model quality | public benchmark priors (SWE-bench Verified/Pro, DeepSWE, Terminal-Bench) blended with a hidden-test bench (fix, code, ui, hard) |
| Concurrency | `limits.mjs`: total by CPU cores (12 cores -> 6 jobs), RAM and CPU-load guards, 2 jobs per cloud model, 1 local model job |
| Guards | stall watchdog, kill after 150 s with no first event, silent-done detection, OpenCode free-quota detection (all opencode models skipped for 3 h), infra failures never recorded as 0% quality |
| Dashboard | background server with no console window, Edge app window, 4-second intro, 7 pages, notification center, light/dark, EN/VI, fox branding |
| Packaging | marketplace with two plugins, setup script (creates `maestro`/`oc`, data dir `~/.claude-studio/maestro`), sync script that strips personal paths and third-party thumbnails |

## 3. Verification (2026-10-29)

| Check | Result |
|---|---|
| `claude plugin validate .` | passed |
| Install from the local marketplace, both plugins enabled, then uninstall + remove marketplace | passed |
| Plugin setup into an empty npm prefix (`maestro.cmd`, `oc.cmd`, POSIX scripts, data dir with seeded `models.json`) | passed; `oc limits` and `maestro status` ran from the created commands |
| Single job (Antigravity Gemini) | done in 14 s, generated test passed |
| Batch of 2 parallel jobs (repo docs) | both done (Gemini) |
| Pause / resume | commands accepted; the test job finished before the pause took effect (Gemini answered in ~12 s) |
| Stop | job stopped within 4 s, status `stopped` |
| Fallback | first model ended with no work, the chain moved to the next model, which completed the task |
| OpenCode quota exhausted | detected in ~30 s (before: 5 min stall), opencode models skipped, work moved to Gemini |
| Dashboard pages light + dark, phone width | screenshots in `docs/screenshots/`, no page errors |
| Notification button, range buttons (Today / 24 h / 7 days) | fixed and re-tested with real clicks |

## 4. Model ranking basis

Quality priors gathered from public reports (vendor numbers where no independent run exists):

| Model | Prior | Main basis |
|---|---|---|
| Claude Opus 5.5 / Sonnet 5.5 | 0.95 / 0.90 | SWE-bench Pro 89.9 / 81.3 |
| Claude Opus 4.6 / Sonnet 4.6 (via Antigravity) | 0.82 / 0.80 | SWE-bench Verified 80.8 / 79.6 |
| Gemini 3.8 Flash (high) | 0.80 | DeepSWE 73.7, Terminal-Bench 2.1 ~89 |
| DeepSeek V4 Flash | 0.79 | SWE-bench Verified ~79 |
| GLM-5.3 Flash | 0.75 | Terminal-Bench 2.1 84.3, DeepSWE 63.4 |
| MiMo V2.6 Flash | 0.74 | DeepSWE 67.9 (vendor) |
| GPT-6 Luna | 0.72 | DeepSWE 66.6 |
| Nemotron 3.5 Super / Lightning | 0.65 / 0.55 | SWE-bench Pro 51.8 / Verified ~52 |
| GPT-OSS 120B | 0.45 | vendor 62.4, ~26 on the official harness |
| Local 4-7B (Ollama) | 0.25 | weak tool calling in real runs |

big-pickle and beam are undisclosed models; they are ranked by the hidden-test bench only.

## 5. Incidents and fixes

| Incident | Cause | Fix |
|---|---|---|
| Many jobs "stalled" overnight, bench scores of 0% | OpenCode free usage limit reached; opencode retried silently | quota detection from logs, 3 h skip for all opencode models, bench keeps previous scores on infra failures |
| Scheduled continuation at 03:31 did nothing | Windows Update restarted the machine at 03:45 (outside active hours) | documented; keep active hours over the night or pause updates before long runs |
| Antigravity jobs ended without work | headless `agy` denies every terminal command and ends the turn | the runner tells the agent to use file tools only; Claude runs tests afterwards |
| Dashboard opened a terminal tab | server spawned without hidden console | server started detached and hidden; `maestro close` to stop |
| Notification and range buttons did nothing | a wiring call was lost / a local variable shadowed `setRange` | fixed |

## 6. Known limitations

- Antigravity in headless mode cannot run terminal commands, even with allow-rules in
  `~/.gemini/antigravity-cli/settings.json`; tests are run by Claude after the job.
- OpenCode's free quota is shared by all its free models and has no published reset time.
- Pause/resume of very short jobs is hard to observe; it suspends the process tree on Windows (NtSuspendProcess).
- web-studio's template crawler depends on the layout of third-party sites and may need updates.

## 7. Follow-up (0.3.x)

| Weak point found in review | Done |
|---|---|
| No automated tests for a large controller edited by many agents | `maestro selftest` (55 checks incl. real browser clicks); a reintroduced bug was caught |
| Gemini low effort left a large UI job half-done | low effort limited to quick jobs; UI and hard jobs go to flash-high |
| Settings lost when the browser clears site data | preferences saved server-side |
| Timeline unreadable with many jobs | windows with navigation, capped rows and projects |
| API keys | `maestro keys` + Settings > Providers, opt-in paid use with daily budgets |
| macOS/Linux | code paths reviewed: pause uses SIGSTOP/SIGCONT, dashboard opens with `open`/`xdg-open`; not yet run on a real Mac/Linux machine |

## 8. Next steps

- Re-run the hidden-test bench on opencode models after their quota resets.
- Antigravity: switch to command execution if a supported headless allow mechanism appears.
- Test a paid provider with a real key (spend tracking relies on the cost opencode reports).
- Cross-platform test of the setup script on macOS and Linux.
