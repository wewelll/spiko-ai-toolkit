import { describe, expect, it } from "vitest"
import { routeOperations } from "../../../tools/cli-routes.ts"

describe("generated CLI route policy", () => {
  it("resolves base-route collisions from exact Operation identities", () => {
    expect(
      routeOperations([
        {
          method: "GET",
          operationId: "Get Net Asset Value",
          path: "/net-asset-values/{shareClassSymbol}/{day}",
          resource: "net-asset-values",
        },
        {
          method: "GET",
          operationId: "Get Net Asset Values",
          path: "/net-asset-values/{shareClassSymbol}",
          resource: "net-asset-values",
        },
      ]),
    ).toEqual([
      { action: "get-net-asset-value", resource: "net-asset-values" },
      { action: "get-net-asset-values", resource: "net-asset-values" },
    ])
  })

  it("uses source semantic verbs for non-generic mutations", () => {
    expect(
      routeOperations([
        {
          method: "POST",
          operationId: "investorDocuments.uploadInvestorDocument",
          path: "/v0/investor-documents",
          resource: "investor-documents",
        },
      ]),
    ).toEqual([{ action: "upload", resource: "investor-documents" }])
  })

  it("fails when deterministic fallback actions still collide", () => {
    expect(() =>
      routeOperations([
        {
          method: "GET",
          operationId: "One Value",
          path: "/values/{id}",
          resource: "values",
        },
        {
          method: "GET",
          operationId: "one-value",
          path: "/values/{id}/{day}",
          resource: "values",
        },
      ]),
    ).toThrow("Generated CLI route collision(s): values/one-value")
  })
})
