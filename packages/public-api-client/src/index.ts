import { Config, Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as Generated from "./generated.ts"

export * from "./generated.ts"

export const defaultBaseUrl = "https://public-api.spiko.io/v0"

export interface PublicApiOptions {
  readonly baseUrl?: string
}

export interface PublicApiClient extends Generated.SpikoPublicApi {
  readonly baseUrl: string
}

export const make = (
  httpClient: HttpClient.HttpClient,
  options: PublicApiOptions = {},
): PublicApiClient => {
  const baseUrl = options.baseUrl ?? defaultBaseUrl
  return {
    ...Generated.make(
      httpClient.pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl))),
    ),
    baseUrl,
  }
}

export class PublicApi extends Context.Service<PublicApi, PublicApiClient>()(
  "@spiko/public-api-client/PublicApi",
) {}

export const makeFromConfig = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient
  const baseUrl = yield* Config.string("SPIKO_PUBLIC_API_BASE_URL").pipe(
    Config.withDefault(defaultBaseUrl),
  )
  return make(httpClient, { baseUrl })
})

export const layer = Layer.effect(PublicApi, makeFromConfig)
