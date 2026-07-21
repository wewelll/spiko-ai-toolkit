import { Config, Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

export const defaultBaseUrl = "https://public-api.spiko.io/v0"

export type QueryValue = boolean | number | string | undefined

export interface SpikoResult {
  readonly data: unknown
  readonly source: string
}

export interface SpikoApiService {
  readonly get: (
    path: string,
    query?: Readonly<Record<string, QueryValue>>,
  ) => Effect.Effect<SpikoResult, SpikoApiError>
}

export class SpikoApiError extends Schema.TaggedErrorClass<SpikoApiError>()("SpikoApiError", {
  message: Schema.String,
}) {}

export class SpikoApi extends Context.Service<SpikoApi, SpikoApiService>()(
  "spiko-mcp-server/SpikoApi",
) {}

export const buildUrl = (
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, QueryValue>> = {},
): URL => {
  const url = new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`)

  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value))
    }
  }

  return url
}

export const make = Effect.gen(function* () {
  const baseUrl = yield* Config.string("SPIKO_API_BASE_URL").pipe(
    Config.withDefault(defaultBaseUrl),
  )
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const get: SpikoApiService["get"] = (path, query = {}) =>
    Effect.gen(function* () {
      const url = buildUrl(baseUrl, path, query)

      const response = yield* client.get(url)
      const data = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(response)

      return {
        data,
        source: url.toString(),
      }
    }).pipe(
      Effect.withSpan("SpikoApi.get", { attributes: { path } }),
      Effect.mapError(
        (cause) =>
          new SpikoApiError({
            message: String(cause),
          }),
      ),
    )

  return { get }
})

export const layer = Layer.effect(SpikoApi, make)

export const get = (
  path: string,
  query?: Readonly<Record<string, QueryValue>>,
): Effect.Effect<SpikoResult, SpikoApiError, SpikoApi> =>
  Effect.flatMap(SpikoApi, (api) => api.get(path, query))
