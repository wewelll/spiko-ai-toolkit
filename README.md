# Spiko API Toolkit

An Effect-native PNPM monorepo for [Spiko's APIs](https://docs.spiko.io/developers/introduction).

It contains generated, schema-decoding HTTP clients for every Spiko API, a `spiko` CLI, and an MCP stdio server. The MCP surface remains intentionally restricted to the unauthenticated, read-only Public API.

## Stack

- TypeScript 7
- Effect 4 beta and Effect Platform
- Effect's official OpenAPI generator
- Effect's native MCP module
- Node.js 24 LTS
- PNPM 11
- Vitest, Rolldown, Oxlint, and Oxfmt

## Workspace

```text
apps/
  cli/                         # `spiko` CLI
  mcp-server/                  # read-only MCP stdio server
packages/
  public-api-client/           # generated Public API client
  investor-api-client/         # generated Investor API client
  distributor-api-client/      # generated Distributor API client
openapi/                       # committed source specifications
tools/generate-clients.ts      # Effect-based downloader and generator
```

Each client is generated with
[`@effect/openapi-generator`](https://github.com/Effect-TS/effect/tree/main/packages/tools/openapi-generator)
in `httpclient` mode. Responses are decoded at runtime with Effect Schema.

## Setup

```sh
fnm use
corepack enable
pnpm install
pnpm check
pnpm build
```

## Generated clients

The committed OpenAPI specifications make normal generation reproducible and offline:

```sh
pnpm generate:clients
```

Download the latest Public, Investor, and Distributor specs before regenerating:

```sh
pnpm specs:update
```

A scheduled GitHub Action runs this refresh every Monday and opens or updates a pull request when generated output changes.

Client configuration:

- Public: `SPIKO_PUBLIC_API_BASE_URL`
- Investor: `SPIKO_INVESTOR_ACCESS_TOKEN`, or `SPIKO_INVESTOR_CLIENT_ID` and `SPIKO_INVESTOR_CLIENT_SECRET`
- Distributor: `SPIKO_DISTRIBUTOR_CLIENT_ID` and `SPIKO_DISTRIBUTOR_CLIENT_SECRET`
- Optional authenticated endpoint overrides: `SPIKO_INVESTOR_API_BASE_URL` and `SPIKO_DISTRIBUTOR_API_BASE_URL`

Secrets are loaded through Effect Config as redacted values.

## CLI

List the generated operations:

```sh
node apps/cli/dist/index.js operations public
node apps/cli/dist/index.js operations investor
node apps/cli/dist/index.js operations distributor
```

Call an operation using JSON objects for its OpenAPI parameter groups:

```sh
node apps/cli/dist/index.js call public GetFund \
  --path '{"fundId":"00000000-0000-0000-0000-000000000000"}'

node apps/cli/dist/index.js call public GetLatestExchangeRate \
  --params '{"fundId":"...","baseCurrency":"EUR","quoteCurrency":"USD"}'
```

The generated client validates response bodies. Required OpenAPI parameters are checked before the request. Every non-GET/HEAD call requires `--confirm`; idempotency headers declared by Spiko must be supplied in `--params`.

## MCP server

For development:

```sh
pnpm dev:mcp
```

For the bundled server:

```sh
pnpm build
node apps/mcp-server/dist/index.js
```

MCP clients should launch `node` with the absolute path to the MCP bundle:

```json
{
  "mcpServers": {
    "spiko": {
      "command": "node",
      "args": ["/absolute/path/to/spiko-mcp-server/apps/mcp-server/dist/index.js"]
    }
  }
}
```

## Available tools

- Funds: `list_funds`, `get_fund`
- Share classes: `list_share_classes`, `get_share_class`, `get_share_class_yield`, `get_share_class_totals`, `get_share_class_totals_from_day`
- NAV and indexes: `get_net_asset_value`, `get_net_asset_values`, `get_latest_net_asset_value`, `get_index_values`, `get_spkcc_chart_data`
- Portfolio data: `get_fund_assets`
- Foreign exchange: `get_exchange_rate`, `get_latest_exchange_rate`

Every tool is annotated as read-only, non-destructive, and idempotent.

## Development

```sh
pnpm generate:check
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [AGENTS.md](./AGENTS.md) for the constraints and architecture expected of OpenCode and other coding agents. Generated files contain a header and must never be edited manually.

## License

MIT
