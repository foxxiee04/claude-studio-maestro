# Contributing to claude-studio

Thank you for your interest in contributing to `claude-studio`. We welcome bug reports, feature suggestions, and pull requests.

## Proposing Changes

- For small bug fixes and documentation updates, feel free to open a pull request directly.
- For substantial changes, architecture adjustments, or new features, please open an issue first to discuss the design and scope before writing code.

## Local Development Setup

### Prerequisites

- Node.js 20 or higher
- Claude Code CLI

### Setup

Run the setup scripts for each plugin:

```bash
node plugins/maestro/scripts/setup.mjs
node plugins/web-studio/scripts/setup.mjs
```

### Validating Plugins

Before submitting changes, validate the marketplace plugin structure:

```bash
claude plugin validate .
```

### Syncing from a Local Install

To mirror updates from a local installation or test workspace into the repository:

```bash
# Preview sync changes without modifying files:
node scripts/sync-from-local.mjs --dry

# Apply sync:
node scripts/sync-from-local.mjs
```

## Code Style & Conventions

- **JavaScript / Modules**: Use modern ECMAScript modules (`import` / `export`).
- **Dependencies**: Keep Maestro dependency-free. Do not add external npm dependencies to `plugins/maestro`.
- **Comments**: Write self-documenting code. Add comments only where logic is non-obvious or complex.
- **Tone**: Plain, concise, professional English. Avoid emojis and promotional phrasing.

## Privacy & Sensitive Data

Never commit runtime data, user logs, or personal artifacts. Specifically ensure:

- No `stats.json` files or benchmark history.
- No agent or job execution logs (`*.log`).
- No crawled template thumbnails or scrapings (`catalog.json`, `thumbs/`).
