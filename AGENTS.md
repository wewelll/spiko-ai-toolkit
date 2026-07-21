# Engineering guide

This repository is an Effect-native MCP server for Spiko's API. Keep the codebase small, explicit, and friendly to coding agents.

## Required stack

- Node.js 24 LTS and PNPM 11
- TypeScript 7 in strict mode
- Effect 4 beta
- Effect Platform Node adapters
- Effect's `effect/unstable/ai/McpServer`, `Tool`, and `Toolkit` modules
- Vitest, Rolldown, Oxlint, and Oxfmt

Do not add a dependency when Effect or the platform already provides the capability. Discuss any new runtime dependency before installing it. Pin exact dependency versions while Effect 4 is in beta.

## Architecture

- `src/spiko-api.ts`: outbound HTTP boundary and typed failures
- `src/tools.ts`: MCP tool schemas and handlers
- `src/server.ts`: Effect layer composition
- `src/index.ts`: Node runtime entry point only

Keep API concerns out of MCP transport code. Model configuration and dependencies with Effect services and layers. Model expected failures in the Effect error channel. Validate every MCP input with Effect Schema.

## Safety

The initial server exposes only Spiko's unauthenticated, read-only Public API. New Investor or Distributor API tools need explicit review. Money-moving or state-changing operations must be clearly annotated, require approval, use idempotency where Spiko supports it, and have focused tests.

Never write logs to stdout because stdout carries MCP protocol messages. Effect logging must remain on stderr.

## Workflow

Run `pnpm check` and `pnpm build` before considering a change complete. Add focused tests for behavior, not implementation details. Keep tool names stable and snake_case.

Primary documentation:

- Spiko API: https://docs.spiko.io/developers/introduction
- Public OpenAPI: https://public-api.spiko.io/v0/docs/openapi.json
- Effect: https://effect.website/docs/
