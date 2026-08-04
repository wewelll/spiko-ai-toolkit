import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as Generated from "./generated.ts"

export * from "./generated.ts"

export const defaultBaseUrl = "https://investor-api.spiko.io/v1"

export type InvestorApiAuth =
  | {
      readonly type: "apiKey"
      readonly apiKey: Redacted.Redacted
    }
  | {
      readonly type: "basic"
      readonly clientId: Redacted.Redacted
      readonly clientSecret: Redacted.Redacted
    }
  | {
      readonly type: "bearer"
      readonly accessToken: Redacted.Redacted
    }

export interface InvestorApiOptions {
  readonly auth: InvestorApiAuth
  readonly baseUrl?: string
}

export interface InvestorApiClient extends Generated.SpikoInvestorApi {
  readonly baseUrl: string
}

export const make = (
  httpClient: HttpClient.HttpClient,
  options: InvestorApiOptions,
): InvestorApiClient => {
  const baseUrl = options.baseUrl ?? defaultBaseUrl
  const authenticate =
    options.auth.type === "basic"
      ? HttpClientRequest.basicAuth(options.auth.clientId, options.auth.clientSecret)
      : HttpClientRequest.bearerToken(
          options.auth.type === "apiKey" ? options.auth.apiKey : options.auth.accessToken,
        )

  return {
    ...Generated.make(
      httpClient.pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)),
        HttpClient.mapRequest(authenticate),
      ),
    ),
    baseUrl,
  }
}

export class InvestorApi extends Context.Service<InvestorApi, InvestorApiClient>()(
  "@spiko/investor-api-client/InvestorApi",
) {}

export const makeFromConfig = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient
  const baseUrl = yield* Config.string("SPIKO_INVESTOR_API_BASE_URL").pipe(
    Config.withDefault(defaultBaseUrl),
  )
  const apiKey = yield* Config.option(Config.redacted("SPIKO_INVESTOR_API_KEY"))

  if (Option.isSome(apiKey)) {
    return make(httpClient, {
      auth: { apiKey: apiKey.value, type: "apiKey" },
      baseUrl,
    })
  }

  const accessToken = yield* Config.option(Config.redacted("SPIKO_INVESTOR_ACCESS_TOKEN"))

  if (Option.isSome(accessToken)) {
    return make(httpClient, {
      auth: { accessToken: accessToken.value, type: "bearer" },
      baseUrl,
    })
  }

  const clientId = yield* Config.redacted("SPIKO_INVESTOR_CLIENT_ID")
  const clientSecret = yield* Config.redacted("SPIKO_INVESTOR_CLIENT_SECRET")
  return make(httpClient, {
    auth: { clientId, clientSecret, type: "basic" },
    baseUrl,
  })
})

export const layer = Layer.effect(InvestorApi, makeFromConfig)
