# Spiko AI Toolkit

AI toolkit for interacting with [Spiko's APIs](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

This PNPM workspace contains:

- Generated clients for the Public, Investor, and Distributor APIs
- A `spiko` command-line client
- An MCP server exposing the Public API and all Investor API operations

## Installation

Install the CLI from npm with:

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
      "args": ["-y", "spiko-mcp"],
      "env": {
        "SPIKO_INVESTOR_API_KEY": "your-api-key"
      }
    }
  }
}
```

Persist the Investor API key in your operating system keychain:

```sh
spiko auth login
spiko auth status
```

For CI or temporary overrides, provide the same key through the environment:

```sh
export SPIKO_INVESTOR_API_KEY=your-api-key
spiko call investor investors
```

The key is sent as an `Authorization: Bearer` token. Environment credentials take precedence over the stored key. Run `spiko auth logout` to remove the stored key.

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
