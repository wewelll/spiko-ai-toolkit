# Spiko AI Toolkit

AI toolkit for interacting with [Spiko's APIs](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

This PNPM workspace contains:

- Generated clients for the Public, Investor, and Distributor APIs
- A `spiko` command-line client with agent mode (structured envelopes, JSON help, and machine-readable discovery when driven by coding agents)
- A read-only MCP server, currently exposing the Public API

## Installation

Install the CLI from npm with:

```sh
npm install --global spiko-cli
spiko --help
```

The CLI exposes generated discovery and invocation commands for all 115 committed Operations. See [`apps/cli/README.md`](apps/cli/README.md) for grammar, authentication, JSON payloads, multipart files, output, and exit statuses.

Configure the MCP server in your MCP client with:

```json
{
  "mcpServers": {
    "spiko": {
      "command": "npx",
      "args": ["-y", "spiko-mcp"]
    }
  }
}
```

## Development

```sh
corepack enable
pnpm install
pnpm build
node apps/cli/dist/index.js --help
node apps/mcp-server/dist/index.js
```

Run `pnpm check` to validate the workspace and `pnpm generate:clients` to regenerate clients from the committed OpenAPI specifications.

## License

MIT
