import { describe, expect, it } from "vitest"
import { buildUrl, defaultBaseUrl } from "../src/spiko-api.ts"

describe("buildUrl", () => {
  it("keeps the API version path and encodes query values", () => {
    const url = buildUrl(defaultBaseUrl, "/exchange-rates/latest", {
      baseCurrency: "EUR",
      fallbackToAnyOtherFund: false,
      optional: undefined,
      quoteCurrency: "USD",
    })

    expect(url.toString()).toBe(
      "https://public-api.spiko.io/v0/exchange-rates/latest?baseCurrency=EUR&fallbackToAnyOtherFund=false&quoteCurrency=USD",
    )
  })

  it("supports a configurable base URL", () => {
    expect(buildUrl("http://127.0.0.1:3000/api/", "funds/").toString()).toBe(
      "http://127.0.0.1:3000/api/funds/",
    )
  })
})
