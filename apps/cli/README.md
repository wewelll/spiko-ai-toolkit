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
spiko operations describe <family> <operation-id>
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

JSON request bodies always use `--payload <file>`. Multipart Operations expose typed form and file flags instead. Every method except `GET` and `HEAD` requires `--confirm`; the wizard's final run prompt does not replace it.

The wizard requires interactive stdin and stdout:

```sh
spiko --wizard
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

A successful invocation writes one JSON document to stdout:

```json
{
  "ok": true,
  "operation": "Get Fund",
  "data": {}
}
```

Failures write one JSON document to stderr. Exit statuses are:

- `0`: success
- `1`: configuration, remote, or internal failure
- `2`: invalid command/input, missing confirmation, or non-interactive wizard
- `130`: wizard cancellation

Binary results are represented as `{ "encoding": "base64", "value": "..." }` inside `data`.

## License

MIT
