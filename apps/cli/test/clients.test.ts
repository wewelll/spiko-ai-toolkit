import * as DistributorApi from "@spiko/distributor-api-client"
import * as InvestorApi from "@spiko/investor-api-client"
import * as PublicApi from "@spiko/public-api-client"
import { Effect, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { describe, expect, it } from "vitest"

const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))

const preprocess = (client: HttpClient.HttpClient) =>
  Effect.runSync(client.preprocess(HttpClientRequest.get("/funds/")))

describe("generated client configuration", () => {
  it("prepends the Public API base URL", () => {
    const client = PublicApi.make(unusedHttpClient, {
      baseUrl: "https://public.example.test/v0",
    })

    expect(preprocess(client.httpClient).url).toBe("https://public.example.test/v0/funds/")
  })

  it("adds Investor API bearer authentication", () => {
    const client = InvestorApi.make(unusedHttpClient, {
      auth: {
        accessToken: Redacted.make("secret-token"),
        type: "bearer",
      },
      baseUrl: "https://investor.example.test/v1",
    })
    const request = preprocess(client.httpClient)

    expect(request.url).toBe("https://investor.example.test/v1/funds/")
    expect(request.headers.authorization).toBe("Bearer secret-token")
  })

  it("adds Distributor API basic authentication", () => {
    const client = DistributorApi.make(unusedHttpClient, {
      baseUrl: "https://distributor.example.test/v0",
      clientId: Redacted.make("client-id"),
      clientSecret: Redacted.make("client-secret"),
    })
    const request = preprocess(client.httpClient)

    expect(request.url).toBe("https://distributor.example.test/v0/funds/")
    expect(request.headers.authorization).toBe("Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=")
  })
})
