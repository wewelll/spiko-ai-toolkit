import { describe, expect, it } from "vitest"
import type { OperationDefinition } from "../src/cli.ts"
import { buildAgentSchema, summarizeDefinition } from "../src/agent-schema.ts"

const baseDefinition = {
  action: "create",
  description: "Create Account",
  family: "investor",
  method: "POST",
  operationId: "accounts.createAccount",
  parameters: [],
  path: "/accounts",
  requestBody: null,
  responses: [{ content: [], description: "Success", status: "200" }],
  resource: "accounts",
  safety: "mutation",
} satisfies OperationDefinition

const jsonBodyMutation = {
  ...baseDefinition,
  requestBody: {
    fields: [],
    kind: "json",
    mediaType: "application/json",
    required: true,
    schema: {},
  },
} satisfies OperationDefinition

const bodylessMutation = {
  ...baseDefinition,
  action: "confirm",
  operationId: "accounts.confirmAccount",
  path: "/accounts/confirm",
} satisfies OperationDefinition

const readOperation = {
  ...baseDefinition,
  action: "list",
  method: "GET",
  operationId: "accounts.listAccounts",
  path: "/accounts/",
  requestBody: null,
  safety: "read",
} satisfies OperationDefinition

describe("agent schema", () => {
  const firstAction = (schema: Record<string, unknown>) => {
    const commands = schema.commands as Array<{
      resources: Array<{
        actions: Array<{ command: string; flags: Array<{ flag: string; required: boolean }> }>
      }>
    }>
    return commands[0]?.resources[0]?.actions[0]
  }

  it("advertises --payload and --confirm for JSON-body mutations", () => {
    const action = firstAction(buildAgentSchema([jsonBodyMutation], { version: "test" }))
    expect(action?.flags.map((flag) => flag.flag)).toEqual(["--payload", "--confirm"])
    expect(action?.flags[0]).toMatchObject({ required: true })
  })

  it("advertises --confirm for bodyless mutations", () => {
    const action = firstAction(buildAgentSchema([bodylessMutation], { version: "test" }))
    expect(action?.flags.map((flag) => flag.flag)).toEqual(["--confirm"])
  })

  it("lists discovery commands as structured entries", () => {
    const schema = buildAgentSchema([readOperation], { version: "test" })
    expect(schema.discovery_commands).toContainEqual(
      expect.objectContaining({
        args: ["<family>", "<operation-id>"],
        command: "spiko operations describe",
      }),
    )
  })

  it("claims a scope only when a call subtree was actually filtered", () => {
    const scoped = buildAgentSchema([readOperation], {
      path: ["call", "investor"],
      version: "test",
    })
    expect(scoped.scope).toBe("call investor")

    const unscoped = buildAgentSchema([readOperation], { path: ["operations"], version: "test" })
    expect(unscoped.scope).toBeUndefined()
    // Non-call scopes still render the full catalog instead of dropping it.
    expect(unscoped.commands).toHaveLength(1)
  })

  it("summarizes definitions without inline schemas", () => {
    const summary = summarizeDefinition(jsonBodyMutation)
    expect(summary.requestBody).toEqual({
      fields: [],
      kind: "json",
      mediaType: "application/json",
      required: true,
    })
    expect(JSON.stringify(summary)).not.toContain('"schema"')
  })
})
