import { Effect, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { make } from "../src/index.ts"

describe("Distributor client", () => {
  it("adds the configured base URL and basic authentication", () => {
    const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))
    const client = make(unusedHttpClient, {
      baseUrl: "https://distributor.example.test/v0",
      clientId: Redacted.make("client-id"),
      clientSecret: Redacted.make("client-secret"),
    })
    const request = Effect.runSync(client.httpClient.preprocess(HttpClientRequest.get("/funds/")))

    expect(request.url).toBe("https://distributor.example.test/v0/funds/")
    expect(request.headers.authorization).toBe("Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=")
  })

  it("encodes typed form fields and binary files as FormData", async () => {
    let captured: FormData | undefined
    const httpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.body._tag === "FormData") {
          captured = request.body.formData
        }
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 500 }))
      }),
    )
    const client = make(httpClient, {
      baseUrl: "https://distributor.example.test",
      clientId: Redacted.make("client-id"),
      clientSecret: Redacted.make("client-secret"),
    })
    const file = new File([new Uint8Array([1, 2, 3, 4])], "identity.pdf", {
      type: "application/pdf",
    })

    await Effect.runPromise(
      client
        .investorDocumentsUploadInvestorDocument({
          payload: {
            file: [file],
            investorId: "00000000-0000-4000-8000-000000000001",
            type: "official-id",
          },
        })
        .pipe(Effect.exit),
    )

    expect(captured).toBeDefined()
    expect(captured?.get("investorId")).toBe("00000000-0000-4000-8000-000000000001")
    expect(captured?.get("type")).toBe("official-id")
    const uploaded = captured?.get("file")
    expect(uploaded).toBeInstanceOf(File)
    if (!(uploaded instanceof File)) {
      throw new Error("Expected the multipart file entry")
    }
    expect(uploaded.name).toBe("identity.pdf")
    expect(uploaded.type).toBe("application/pdf")
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})
