# spiko-mcp

[Model Context Protocol](https://modelcontextprotocol.io/) server for [Spiko's Public and Investor APIs](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

## Installation

Configure the server in your MCP client:

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

The API key is sent as an `Authorization: Bearer` token. The server exposes separate read-only and mutating Investor operation tools; mutating calls require `confirm: true`.

See the [Spiko AI Toolkit repository](https://github.com/wewelll/spiko-ai-toolkit) for documentation and source code.

## License

MIT
