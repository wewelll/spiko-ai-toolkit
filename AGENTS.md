# Agent Instructions

- Keep API concerns out of MCP transport code. Put API configuration, authentication, and client composition in the owning API client package.
- Never write logs or diagnostics to stdout in the MCP server; stdout is reserved for protocol messages.
- Prefer Effect, Node.js, or an existing workspace package.
- Effect 4 APIs are beta. For unfamiliar or unstable APIs, consult the installed package source or current upstream source rather than relying on remembered APIs.
