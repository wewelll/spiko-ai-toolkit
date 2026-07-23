# Engineering guide

This repository is an Effect-native PNPM monorepo for Spiko's APIs. Keep the codebase small, explicit, and friendly to coding agents.

## Required stack

- Node.js 24 LTS and PNPM 11
- TypeScript 7 in strict mode
- Effect 4 beta
- Effect Platform Node adapters
- Effect's `effect/unstable/ai/McpServer`, `Tool`, and `Toolkit` modules
- Effect's `@effect/openapi-generator`
- Effect's unstable CLI module
- Vitest, Rolldown, Oxlint, and Oxfmt

Do not add a dependency when Effect or the platform already provides the capability. Discuss any new runtime dependency before installing it. Pin exact dependency versions while Effect 4 is in beta.

## Workspace architecture

- `packages/*-api-client`: one generated Effect Platform HTTP client per Spiko API
- `packages/*-api-client/src/generated.ts`: generated code; never edit it manually
- `packages/*-api-client/src/index.ts`: configuration, authentication, services, and layers
- `apps/cli`: the `spiko` CLI using the generated clients
- `apps/mcp-server`: read-only MCP tools using `@spiko/public-api-client`
- `openapi`: committed source specifications
- `tools/generate-clients.ts`: Effect-based spec downloader and code generator

Keep API concerns out of MCP transport code. Model configuration and dependencies with Effect services and layers. Model expected failures in the Effect error channel. Validate every MCP input with Effect Schema.

Do not hand-write DTOs already represented in generated clients. If a spec changes, run `pnpm specs:update`; if generator behavior changes, update `tools/generate-clients.ts`.

## Safety

The MCP server exposes only Spiko's unauthenticated, read-only Public API. New Investor or Distributor API tools need explicit review. Money-moving or state-changing operations must be clearly annotated, require approval, use idempotency where Spiko supports it, and have focused tests. The CLI requires `--confirm` for all non-GET/HEAD operations.

Never write logs to stdout because stdout carries MCP protocol messages. Effect logging must remain on stderr.

## Workflow

Run `pnpm check` and `pnpm build` before considering a change complete. For generated client changes, also run `pnpm generate:check`. Add focused tests for behavior, not implementation details. Keep MCP tool names stable and snake_case.

Primary documentation:

- Spiko API: https://docs.spiko.io/developers/introduction
- Public OpenAPI: https://public-api.spiko.io/v0/docs/openapi.json
- Investor OpenAPI: https://investor-api.spiko.io/v1/docs/openapi.json
- Distributor OpenAPI: https://distributor-api.spiko.io/v0/docs/openapi.json
- Effect OpenAPI generator: https://github.com/Effect-TS/effect/tree/main/packages/tools/openapi-generator
- Effect: https://effect.website/docs/
