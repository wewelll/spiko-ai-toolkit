# Spiko MCP Server

An Effect-native Model Context Protocol server for [Spiko's API](https://docs.spiko.io/developers/introduction).

The bootstrap exposes all 15 read-only operations from Spiko's unauthenticated Public API over MCP stdio. It intentionally does not expose Investor or Distributor API mutations yet.

## Stack

- TypeScript 7
- Effect 4 beta and Effect Platform
- Effect's native MCP module
- Node.js 24 LTS
- PNPM 11
- Vitest, Rolldown, Oxlint, and Oxfmt

## Setup

```sh
fnm use
corepack enable
pnpm install
pnpm check
pnpm build
```

The default API endpoint is `https://public-api.spiko.io/v0`. Override it for a mock or proxy with `SPIKO_API_BASE_URL`.

## Run

For development:

```sh
pnpm dev
```

For the bundled server:

```sh
pnpm build
pnpm start
```

MCP clients should launch `node` with the absolute path to `dist/index.js`. For example:

```json
{
  "mcpServers": {
    "spiko": {
      "command": "node",
      "args": ["/absolute/path/to/spiko-mcp-server/dist/index.js"]
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
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [AGENTS.md](./AGENTS.md) for the constraints and architecture expected of OpenCode and other coding agents.

## License

MIT
