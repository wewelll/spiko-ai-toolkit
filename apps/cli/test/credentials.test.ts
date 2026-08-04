import * as InvestorApi from "@spiko/investor-api-client"
import { ConfigProvider, Effect, Option, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { describe, expect, it } from "vitest"
import { CredentialStore, make } from "../src/credentials.ts"
import { makeInvestorClient } from "../src/program.ts"

const unusedHttpClient = HttpClient.make(() => Effect.die("not executed"))

const preprocess = (client: HttpClient.HttpClient) =>
  Effect.runSync(client.preprocess(HttpClientRequest.get("/investors/me")))

describe("CredentialStore", () => {
  it("stores, loads, and removes the Investor API key", async () => {
    let password: string | undefined
    const store = make({
      deleteCredential: async () => {
        password = undefined
        return true
      },
      getPassword: async () => password,
      setPassword: async (value) => {
        password = value
      },
    })

    expect(Option.isNone(await Effect.runPromise(store.getInvestorApiKey))).toBe(true)

    await Effect.runPromise(store.setInvestorApiKey(Redacted.make("stored-api-key")))
    const stored = await Effect.runPromise(store.getInvestorApiKey)
    expect(Option.map(stored, Redacted.value)).toEqual(Option.some("stored-api-key"))
    expect(await Effect.runPromise(store.removeInvestorApiKey)).toBe(true)
    expect(await Effect.runPromise(store.removeInvestorApiKey)).toBe(false)
  })

  it("uses the stored API key when the environment key is absent", async () => {
    const store = make({
      deleteCredential: async () => false,
      getPassword: async () => "stored-api-key",
      setPassword: async () => {},
    })
    const client = await Effect.runPromise(
      makeInvestorClient.pipe(
        Effect.provideService(CredentialStore, CredentialStore.of(store)),
        Effect.provideService(HttpClient.HttpClient, unusedHttpClient),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            SPIKO_INVESTOR_API_BASE_URL: "https://investor.example.test/v1",
          }),
        ),
      ),
    )

    expect(preprocess(client.httpClient).headers.authorization).toBe("Bearer stored-api-key")
  })

  it("prefers the environment API key without reading the keychain", async () => {
    const store = CredentialStore.of({
      getInvestorApiKey: Effect.die("keychain should not be read"),
      removeInvestorApiKey: Effect.succeed(false),
      setInvestorApiKey: () => Effect.void,
    })
    const client = await Effect.runPromise(
      makeInvestorClient.pipe(
        Effect.provideService(CredentialStore, store),
        Effect.provideService(HttpClient.HttpClient, unusedHttpClient),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            SPIKO_INVESTOR_API_BASE_URL: InvestorApi.defaultBaseUrl,
            SPIKO_INVESTOR_API_KEY: "environment-api-key",
          }),
        ),
      ),
    )

    expect(preprocess(client.httpClient).headers.authorization).toBe("Bearer environment-api-key")
  })
})
