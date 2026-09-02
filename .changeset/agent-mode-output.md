---
"spiko-cli": minor
---

Add agent mode so AI coding agents get machine-first output without changing the command grammar.

- Agent detection through `CLAUDECODE`, `CURSOR_AGENT`, `CODEX`, `PI_CODING_AGENT`, `AGENT`, and other agent environment variables, with `--agent` / `--no-agent` flags and `SPIKO_AGENT_MODE` / `FORCE_AGENT_MODE` overrides.
- In agent mode, successful invocations wrap the payload in a `{ data, ok, operation, metadata }` envelope carrying the invoked command, array counts, and a script-authoring note; outside agent mode the raw API payload is printed. **This changes the default output shape** — scripts that relied on the always-on envelope should pass `--no-agent` or read `.data` conditionally.
- In agent mode, `--help` renders a scoped JSON schema of the command tree instead of text help.
- New `spiko agent schema [--compact]` command emitting every command with flags plus authentication guidance, best practices, anti-patterns, workflows, and script-authoring rules.
- New `--summary` flag on `spiko operations describe` for token-light descriptions without inline JSON Schemas.
- Failure envelopes now include remediation `suggestions` (for example, re-running mutations with `--confirm`).
