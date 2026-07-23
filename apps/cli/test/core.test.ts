import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { prepareInvocation } from "../src/core.ts"
import type { OperationMetadata } from "../src/generated/operations.ts"

const readOperation: OperationMetadata = {
  description: "Get a fund",
  method: "GET",
  parameters: [
    { in: "path", name: "fundId", required: true },
    { in: "query", name: "day", required: true },
  ],
  path: "/funds/{fundId}",
}

const writeOperation: OperationMetadata = {
  description: "Create an order",
  method: "POST",
  parameters: [],
  path: "/orders",
  requestBody: { required: true },
}

describe("prepareInvocation", () => {
  it("orders path arguments and builds generated client options", async () => {
    const result = await Effect.runPromise(
      prepareInvocation("GetFund", readOperation, {
        confirm: false,
        params: { day: "2026-07-23" },
        path: { fundId: "fund-1" },
        payloadProvided: false,
      }),
    )

    expect(result).toEqual({
      args: ["fund-1", { params: { day: "2026-07-23" } }],
      mutating: false,
    })
  })

  it("requires confirmation before a state-changing call", async () => {
    const exit = await Effect.runPromiseExit(
      prepareInvocation("CreateOrder", writeOperation, {
        confirm: false,
        params: {},
        path: {},
        payload: { amount: "100" },
        payloadProvided: true,
      }),
    )

    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("--confirm")
  })

  it("requires a body when OpenAPI marks it as required", async () => {
    const exit = await Effect.runPromiseExit(
      prepareInvocation("CreateOrder", writeOperation, {
        confirm: true,
        params: {},
        path: {},
        payloadProvided: false,
      }),
    )

    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("--payload")
  })
})
