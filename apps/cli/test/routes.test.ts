import { describe, expect, it } from "vitest"
import { OperationCatalog } from "../src/generated/operations.ts"
import { routeOperations } from "../src/routes.ts"

describe("routeOperations", () => {
  it("maps generated operations to resource-oriented commands", () => {
    const routes = routeOperations(OperationCatalog.public)

    expect(routes.find((route) => route.operationName === "GetFund")).toMatchObject({
      action: "get",
      isDefault: false,
      resource: "funds",
    })
    expect(routes.find((route) => route.operationName === "GetLatestExchangeRate")).toMatchObject({
      action: "latest",
      isDefault: true,
      resource: "exchange-rates",
    })
  })

  it("produces unique action names within every API resource", () => {
    for (const catalog of Object.values(OperationCatalog)) {
      const commands = routeOperations(catalog).map((route) => `${route.resource}/${route.action}`)
      expect(new Set(commands).size).toBe(commands.length)
    }
  })
})
