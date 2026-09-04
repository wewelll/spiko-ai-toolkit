# spiko-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for [Spiko's Public API](https://docs.spiko.io/developers/introduction), built with TypeScript and Effect.

> This is an independent project and is not an official Spiko product.

## Installation

Configure the server in your MCP client:

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

See the [Spiko AI Toolkit repository](https://github.com/samuelbriole/spiko-ai-toolkit) for documentation and source code.

## License

MIT
