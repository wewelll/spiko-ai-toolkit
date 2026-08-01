# Spiko AI Toolkit

AI toolkit for interacting with [Spiko's APIs](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

This PNPM workspace contains:

- Generated clients for the Public, Investor, and Distributor APIs
- A `spiko` command-line client
- A read-only MCP server, currently exposing the Public API

## Installation

The CLI and MCP server will be published to npm. Once available, install the CLI with:

```sh
npm install --global spiko-cli
spiko --help
```

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
