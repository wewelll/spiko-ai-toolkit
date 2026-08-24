import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { describe, expect, it } from "vitest"
import { make } from "../src/index.ts"

const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))

describe("Public client configuration", () => {
  it("prepends the configured base URL", () => {
    const client = make(unusedHttpClient, { baseUrl: "https://public.example.test/v0" })
    const request = Effect.runSync(client.httpClient.preprocess(HttpClientRequest.get("/funds/")))

    expect(request.url).toBe("https://public.example.test/v0/funds/")
  })
})
