# spiko-cli

Command-line access to every Operation in the committed Spiko Public, Investor, and Distributor OpenAPI documents.

> This is an independent project and is not an official Spiko product.

## Installation

```sh
npm install --global spiko-cli
spiko --help
```

## Commands

```text
spiko call <family> <resource> <action> [flags]
spiko operations list <family>
spiko operations describe <family> <operation-id> [--summary]
spiko agent schema [--compact]
spiko --wizard
```

Use discovery instead of guessing names:

```sh
spiko operations list public
spiko operations describe investor "accounts.createAccount"
```

Inputs, enum values, requiredness, and descriptions come from OpenAPI:

```sh
spiko call public funds get \
  --fund-id 00000000-0000-4000-8000-000000000001

spiko call investor accounts create \
  --payload ./account.json \
  --confirm

spiko call distributor investor-documents upload \
  --investor-id 00000000-0000-4000-8000-000000000001 \
  --type official-id \
  --file ./identity.pdf \
  --confirm
```

JSON request bodies always use `--payload <file>`. Payload files are validated and re-encoded against the OpenAPI schema before sending, so unknown properties and JSON formatting are not forwarded byte-for-byte. Multipart Operations expose typed form and file flags instead. Every method except `GET` and `HEAD` requires `--confirm`; the wizard's final run prompt does not replace it.

The wizard requires interactive stdin and stdout:

```sh
spiko --wizard
```

## Agent mode

The CLI is agent-operable: when it detects that a coding agent is driving it, output switches from raw payloads to structured envelopes without changing the command grammar.

Agent mode turns on when any of these hold:

- An agent environment variable is set: `CLAUDECODE`, `CLAUDE_CODE`, `CURSOR_AGENT`, `CODEX`, `OPENAI_CODEX`, `OPENCODE`, `AIDER`, `CLINE`, `WINDSURF_AGENT`, `GITHUB_COPILOT`, `AMAZON_Q`, `AWS_Q_DEVELOPER`, `GEMINI_CODE_ASSIST`, `SRC_CODY`, `PI_CODING_AGENT`, or `AGENT` (Devin's `DEVIN_SESSION_ID` also counts)
- The environment override `SPIKO_AGENT_MODE=1` (or `FORCE_AGENT_MODE=1`) is set; `=0` / `=false` forces agent mode off, overriding detection
- The `--agent` flag is passed

`--no-agent` disables agent mode with the highest precedence — append it whenever you author a script that someone will run outside the current agent session.

What changes in agent mode:

| Behavior       | Human mode         | Agent mode                                                                                                                         |
| -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Success output | Raw API payload    | `{ data, ok, operation, metadata }` envelope with `metadata.command`, `metadata.count` for arrays, and a script-authoring note     |
| `--help`       | Rendered text help | JSON schema of the command tree, scoped to the requested subtree (`spiko call public funds get --help` describes only that action) |
| Errors         | JSON on stderr     | Same JSON plus remediation `suggestions`                                                                                           |

Discovery commands for agents:

```sh
spiko agent schema            # every command with flags, auth, best practices,
                              # anti-patterns, workflows, and script-authoring guidance
spiko agent schema --compact  # command paths + bare flag names only
spiko operations describe <family> "<operation-id>" --summary   # token-light operation description
```

## Configuration

Public calls need no credentials. Optional base URL overrides:

```text
SPIKO_PUBLIC_API_BASE_URL
SPIKO_INVESTOR_API_BASE_URL
SPIKO_DISTRIBUTOR_API_BASE_URL
```

Investor authentication uses either:

```text
SPIKO_INVESTOR_ACCESS_TOKEN
```

or both:

```text
SPIKO_INVESTOR_CLIENT_ID
SPIKO_INVESTOR_CLIENT_SECRET
```

Distributor authentication requires:

```text
SPIKO_DISTRIBUTOR_CLIENT_ID
SPIKO_DISTRIBUTOR_CLIENT_SECRET
```

## Output and exits

Outside agent mode, a successful invocation writes one JSON document to stdout — the raw payload returned by the API:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "slug": "EUTBL"
}
```

In agent mode, the same invocation is wrapped in an envelope:

```json
{
  "data": {},
  "metadata": {
    "command": "call public funds get",
    "note": "This envelope (data/ok/operation/metadata) only appears in agent mode. If you are writing a script the user will run outside this agent session, append --no-agent so its output matches what they will see."
  },
  "ok": true,
  "operation": "Get Fund"
}
```

Failures write one JSON document to stderr in both modes; `error.suggestions` carries remediation hints such as re-running with `--confirm`. Exit statuses are:

- `0`: success
- `1`: configuration, remote, or internal failure
- `2`: invalid command/input, missing confirmation, or non-interactive wizard
- `130`: wizard cancellation

Binary results are represented as `{ "encoding": "base64", "value": "..." }` inside `data`.

## License

MIT
