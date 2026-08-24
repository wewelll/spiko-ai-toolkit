import { Effect, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { make } from "../src/index.ts"

const auth = { accessToken: Redacted.make("secret-token"), type: "bearer" } as const

describe("Investor client", () => {
  it("adds the configured base URL and bearer authentication", () => {
    const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))
    const client = make(unusedHttpClient, {
      auth,
      baseUrl: "https://investor.example.test/v1",
    })
    const request = Effect.runSync(client.httpClient.preprocess(HttpClientRequest.get("/funds/")))

    expect(request.url).toBe("https://investor.example.test/v1/funds/")
    expect(request.headers.authorization).toBe("Bearer secret-token")
  })

  it("returns binary account statements as bytes", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(bytes, { status: 200 }))),
    )
    const client = make(httpClient, {
      auth,
      baseUrl: "https://investor.example.test/v1",
    })

    const statement = await Effect.runPromise(
      client.accountingPositionsDownloadAccountStatement({
        params: {
          from: "2025-01-01",
          investorId: "00000000-0000-4000-8000-000000000001",
          shareClassSymbol: "EUTBL",
          to: "2025-01-31",
        },
      }),
    )

    expect(statement).toEqual(bytes)
  })
})
