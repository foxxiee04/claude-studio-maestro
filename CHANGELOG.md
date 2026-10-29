# Changelog

All notable changes to the `claude-studio` plugins (`maestro` and `web-studio`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-29

### Added
- API-key providers: `maestro keys` (list / add / remove / enable / disable / budget) for OpenAI, Anthropic, Google AI
  Studio, OpenRouter, Groq, Cerebras, DeepSeek, Mistral, xAI, Moonshot, Z.ai, Alibaba, Together and Fireworks. Keys stay
  in opencode's store; Maestro keeps only on/off and a daily budget (`providers.json`) and spend per day (`spend.json`).
- Paid providers are opt-in (`--paid`) and stop for the day at their budget; OpenRouter `:free` models are free.
- Family-based quality priors from public benchmarks, so models added with a key are ranked from their first job.
- Settings > Providers on the dashboard.
- Dashboard preferences are saved server-side (`ui-prefs.json`) and restored on load.
- Timeline: 1h/3h/6h/12h windows with navigation, at most 4 rows per project and 8 projects (expandable).

### Changed
- When OpenCode's free quota runs out and the fallback chain has only opencode models, the job is re-ranked onto
  another runner instead of failing.
- Overview "Running" card shows only the number of running jobs.

## [0.2.0] - 2026-10-29

### Added
- Antigravity CLI runner (`antigravity/gemini-*`).
- Research-based model priors blending public SWE-bench, DeepSWE, and Terminal-Bench metrics with hidden-test benchmarks.
- Adaptive concurrency with CPU, RAM, and per-model limits, configurable via `maestro limits`.
- Capability levels and quota management.
- Diagnostic command `maestro doctor` to inspect agents, models, and skills.
- Background dashboard application managed with `maestro open`, `maestro close`, `maestro status`, and `maestro restart`.
- 4-second intro animation and integrated notification center.
- English and Vietnamese (EN/VI) language support in the dashboard UI.
- Plugin setup script (`scripts/setup.mjs`) and repository sync script (`scripts/sync-from-local.mjs`).

### Changed
- Free-quota detection for OpenCode: automatically skips all opencode models for 3 hours when quota is exhausted.
- Antigravity Claude and GPT models are now opt-in via `--paid`.
- Data directory relocated to `MAESTRO_DATA` (`~/.claude-studio/maestro`).

### Fixed
- Silent "done" state on unfinished jobs.
- Stalled-before-first-event job execution.
- False out-of-scope path warnings.
- `oc stop` failure when invoked with an empty job ID.
- Benchmark recording infrastructure failures as 0% score.

## [0.1.0] - 2026-10-28

Initial private version.
