# Changelog

All notable changes to the `claude-studio` plugins (`maestro` and `web-studio`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
