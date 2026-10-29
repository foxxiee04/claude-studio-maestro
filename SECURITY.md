# Security Policy

## Supported Versions

Security updates and patches are provided for the following releases:

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2.0 | :x:                |

## Agent Sandbox & Isolation Model

Claude Studio coordinates automated coding agents under strict safety boundaries:

- **Project Scoping**: Agent file edits are restricted exclusively to the active project folder. Attempts to access or mutate paths outside this scope are denied.
- **Version Control Safety**: Automated publishing, pushing, and history modification are strictly disallowed. Agents cannot stage, commit, push, or amend version-control history.
- **Dashboard Interface**: The local background dashboard service binds only to `127.0.0.1` (localhost) and enforces CSRF header validation on all incoming `POST` requests.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues or discussions.

Instead, report vulnerabilities privately through GitHub Security Advisories:
- Repository: [foxxiee04/claude-studio-maestro](https://github.com/foxxiee04/claude-studio-maestro/security/advisories)

Include reproducible steps, affected components, and potential impact. Reports will be reviewed and addressed promptly.
