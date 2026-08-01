import { Effect, Option } from "effect"
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

const noParameterOperation: OperationMetadata = {
  description: "List funds",
  method: "GET",
  parameters: [],
  path: "/funds",
}

describe("prepareInvocation", () => {
  it("orders path arguments and builds generated client options", async () => {
    const result = await Effect.runPromise(
      prepareInvocation("GetFund", readOperation, {
        confirm: false,
        params: { day: "2026-07-23" },
        path: { fundId: "fund-1" },
        payload: Option.none(),
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
        payload: Option.some({ amount: "100" }),
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
        payload: Option.none(),
      }),
    )

    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("--payload")
  })

  it("uses Schema to reject missing and unknown operation parameters", async () => {
    const missing = await Effect.runPromiseExit(
      prepareInvocation("GetFund", readOperation, {
        confirm: false,
        params: { day: "2026-07-23" },
        path: {},
        payload: Option.none(),
      }),
    )
    const unknown = await Effect.runPromiseExit(
      prepareInvocation("GetFund", readOperation, {
        confirm: false,
        params: { day: "2026-07-23", typo: "value" },
        path: { fundId: "fund-1" },
        payload: Option.none(),
      }),
    )
    const unsupported = await Effect.runPromiseExit(
      prepareInvocation("GetFunds", noParameterOperation, {
        confirm: false,
        params: { typo: "value" },
        path: {},
        payload: Option.none(),
      }),
    )

    expect(String(missing)).toContain("fundId")
    expect(String(unknown)).toContain("typo")
    expect(String(unsupported)).toContain("not accepted")
  })
})
