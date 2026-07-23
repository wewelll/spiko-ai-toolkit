import { Config, Context, Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as Generated from "./generated.ts"

export * from "./generated.ts"

export const defaultBaseUrl = "https://distributor-api.spiko.io/v0"

export interface DistributorApiOptions {
  readonly baseUrl?: string
  readonly clientId: Redacted.Redacted
  readonly clientSecret: Redacted.Redacted
}

export const make = (
  httpClient: HttpClient.HttpClient,
  options: DistributorApiOptions,
): Generated.SpikoDistributorApi =>
  Generated.make(
    httpClient.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(options.baseUrl ?? defaultBaseUrl)),
      HttpClient.mapRequest(HttpClientRequest.basicAuth(options.clientId, options.clientSecret)),
    ),
  )

export class DistributorApi extends Context.Service<
  DistributorApi,
  Generated.SpikoDistributorApi
>()("@spiko/distributor-api-client/DistributorApi") {}

export const makeFromConfig = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient
  const baseUrl = yield* Config.string("SPIKO_DISTRIBUTOR_API_BASE_URL").pipe(
    Config.withDefault(defaultBaseUrl),
  )
  const clientId = yield* Config.redacted("SPIKO_DISTRIBUTOR_CLIENT_ID")
  const clientSecret = yield* Config.redacted("SPIKO_DISTRIBUTOR_CLIENT_SECRET")
  return make(httpClient, { baseUrl, clientId, clientSecret })
})

export const layer = Layer.effect(DistributorApi, makeFromConfig)
