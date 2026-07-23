import * as DistributorApi from "@spiko/distributor-api-client"
import * as InvestorApi from "@spiko/investor-api-client"
import * as PublicApi from "@spiko/public-api-client"
import { Console, Effect, Option, Schema, SchemaTransformation } from "effect"
import * as Argument from "effect/unstable/cli/Argument"
import * as CliError from "effect/unstable/cli/CliError"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type { ApiName, OperationMetadata } from "./generated/operations.ts"
import { ApiNames, OperationCatalog } from "./generated/operations.ts"
import { CliInputError, prepareInvocation } from "./core.ts"

type DynamicClient = Readonly<
  Record<string, (...args: ReadonlyArray<never>) => Effect.Effect<unknown, unknown>>
>

const JsonFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, SchemaTransformation.fromJsonString),
)

const JsonObject = Schema.Record(Schema.String, Schema.Unknown)

const decodeObject = (
  option: Option.Option<string>,
  flag: string,
): Effect.Effect<Readonly<Record<string, unknown>>, CliInputError> =>
  Option.match(option, {
    onNone: () => Effect.succeed({}),
    onSome: (value) =>
      Schema.decodeUnknownEffect(JsonFromString)(value).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(JsonObject)),
        Effect.mapError(
          (cause) =>
            new CliInputError({
              message: `${flag} must be a JSON object: ${cause.message}`,
            }),
        ),
      ),
  })

const decodePayload = (option: Option.Option<string>): Effect.Effect<unknown, CliInputError> =>
  Option.match(option, {
    onNone: () => Effect.succeed(undefined),
    onSome: (value) =>
      Schema.decodeUnknownEffect(JsonFromString)(value).pipe(
        Effect.mapError(
          (cause) =>
            new CliInputError({
              message: `--payload must be valid JSON: ${cause.message}`,
            }),
        ),
      ),
  })

const getClient = (api: ApiName): Effect.Effect<DynamicClient, unknown, HttpClient.HttpClient> => {
  switch (api) {
    case "public":
      return PublicApi.makeFromConfig.pipe(
        Effect.map((client) => client as unknown as DynamicClient),
      )
    case "investor":
      return InvestorApi.makeFromConfig.pipe(
        Effect.map((client) => client as unknown as DynamicClient),
      )
    case "distributor":
      return DistributorApi.makeFromConfig.pipe(
        Effect.map((client) => client as unknown as DynamicClient),
      )
  }
}

const resolveOperation = (
  api: ApiName,
  requested: string,
): readonly [string, OperationMetadata] | undefined => {
  const entries = Object.entries(OperationCatalog[api]) as Array<[string, OperationMetadata]>
  return (
    entries.find(([name]) => name === requested) ??
    entries.find(([name]) => name.toLowerCase() === requested.toLowerCase())
  )
}

const action = Argument.choice("action", ["operations", "call"] as const).pipe(
  Argument.withDescription("List operations or call one generated client method"),
)

const api = Argument.choice("api", ApiNames).pipe(Argument.withDescription("The Spiko API to use"))

const operation = Argument.string("operation").pipe(
  Argument.optional,
  Argument.withDescription("Generated OpenAPI operation name"),
)

const path = Flag.string("path").pipe(
  Flag.optional,
  Flag.withDescription('JSON object containing path parameters, e.g. \'{"fundId":"..."}\''),
)

const params = Flag.string("params").pipe(
  Flag.optional,
  Flag.withDescription("JSON object containing query and header parameters"),
)

const payload = Flag.string("payload").pipe(
  Flag.optional,
  Flag.withDescription("JSON request body"),
)

const confirm = Flag.boolean("confirm").pipe(
  Flag.withDescription("Explicitly approve a non-read-only API operation"),
)

export const rootCommand = Command.make(
  "spiko",
  { action, api, confirm, operation, params, path, payload },
  ({ action, api, confirm, operation, params, path, payload }) =>
    Effect.gen(function* () {
      if (action === "operations") {
        const operations = Object.entries(OperationCatalog[api]).map(([name, metadata]) => ({
          description: metadata.description,
          method: metadata.method,
          name,
          path: metadata.path,
        }))
        return yield* Console.log(JSON.stringify(operations, null, 2))
      }

      if (Option.isNone(operation)) {
        return yield* new CliError.UserError({
          cause: new CliInputError({
            message: "The call action requires an operation name. Use `spiko operations <api>`.",
          }),
        })
      }

      const resolved = resolveOperation(api, operation.value)
      if (resolved === undefined) {
        return yield* new CliError.UserError({
          cause: new CliInputError({
            message: `Unknown ${api} operation "${operation.value}". Use \`spiko operations ${api}\`.`,
          }),
        })
      }

      const [operationName, metadata] = resolved
      const pathValues = yield* decodeObject(path, "--path")
      const parameterValues = yield* decodeObject(params, "--params")
      const payloadValue = yield* decodePayload(payload)
      const invocation = yield* prepareInvocation(operationName, metadata, {
        confirm,
        params: parameterValues,
        path: pathValues,
        payload: payloadValue,
        payloadProvided: Option.isSome(payload),
      })
      const client = yield* getClient(api)
      const method = client[operationName]

      if (method === undefined) {
        return yield* new CliError.UserError({
          cause: new CliInputError({
            message: `The generated ${api} client does not expose "${operationName}". Regenerate the clients.`,
          }),
        })
      }

      const result = yield* method(...(invocation.args as ReadonlyArray<never>))
      yield* Console.log(JSON.stringify(result, null, 2))
    }).pipe(
      Effect.mapError((cause) =>
        CliError.isCliError(cause) ? cause : new CliError.UserError({ cause }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Interact with Spiko's generated Effect HTTP clients. Credentials are read from the environment.",
  ),
)

export const program = Command.run(rootCommand, { version: "0.1.0" })
