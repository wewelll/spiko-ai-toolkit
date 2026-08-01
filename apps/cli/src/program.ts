import * as DistributorApi from "@spiko/distributor-api-client"
import * as InvestorApi from "@spiko/investor-api-client"
import * as PublicApi from "@spiko/public-api-client"
import { Console, Effect, Option, Predicate, Schema } from "effect"
import { Argument, CliError, Command, Flag } from "effect/unstable/cli"
import type { ApiName, OperationMetadata } from "./generated/operations.ts"
import { ApiNames, OperationCatalog } from "./generated/operations.ts"
import { CliInputError, prepareInvocation } from "./core.ts"

const getClient = (api: ApiName) => {
  switch (api) {
    case "public":
      return PublicApi.makeFromConfig
    case "investor":
      return InvestorApi.makeFromConfig
    case "distributor":
      return DistributorApi.makeFromConfig
  }
}

const isClientEffect = (value: unknown): value is Effect.Effect<unknown, unknown> =>
  Effect.isEffect(value)

const invokeClient = Effect.fn("Cli.invokeClient")(function* (
  api: ApiName,
  client: unknown,
  operationName: string,
  args: ReadonlyArray<unknown>,
) {
  const method = Predicate.isObject(client) ? client[operationName] : undefined
  if (!Predicate.isFunction(method)) {
    return yield* new CliInputError({
      message: `The generated ${api} client does not expose "${operationName}". Regenerate the clients.`,
    })
  }

  const result: unknown = method(...args)
  if (!isClientEffect(result)) {
    return yield* new CliInputError({
      message: `The generated ${api} client operation "${operationName}" did not return an Effect.`,
    })
  }

  return yield* result
})

const resolveOperation = (
  api: ApiName,
  requested: string,
): readonly [string, OperationMetadata] | undefined => {
  const entries: ReadonlyArray<readonly [string, OperationMetadata]> = Object.entries(
    OperationCatalog[api],
  )
  return (
    entries.find(([name]) => name === requested) ??
    entries.find(([name]) => name.toLowerCase() === requested.toLowerCase())
  )
}

const api = Argument.choice("api", ApiNames).pipe(Argument.withDescription("The Spiko API to use"))

const operation = Argument.string("operation").pipe(
  Argument.withDescription("Generated OpenAPI operation name"),
)

const path = Flag.keyValuePair("path").pipe(
  Flag.optional,
  Flag.withDescription("Path parameter as key=value; repeat the flag for multiple parameters"),
)

const params = Flag.keyValuePair("param").pipe(
  Flag.optional,
  Flag.withDescription("Query, header, or cookie parameter as key=value; repeat as needed"),
)

const payload = Flag.fileSchema("payload", Schema.Json, { format: "json" }).pipe(
  Flag.optional,
  Flag.withDescription("Path to a JSON request body file"),
)

const confirm = Flag.boolean("confirm").pipe(
  Flag.withDescription("Explicitly approve a non-read-only API operation"),
)

const operationsCommand = Command.make("operations", { api }, ({ api }) => {
  const operations = Object.entries(OperationCatalog[api]).map(([name, metadata]) => ({
    description: metadata.description,
    method: metadata.method,
    name,
    path: metadata.path,
  }))
  return Console.log(JSON.stringify(operations, null, 2))
}).pipe(Command.withDescription("List generated operations for a Spiko API"))

const callCommand = Command.make(
  "call",
  { api, confirm, operation, params, path, payload },
  ({ api, confirm, operation, params, path, payload }) =>
    Effect.gen(function* () {
      const resolved = resolveOperation(api, operation)
      if (resolved === undefined) {
        return yield* new CliError.UserError({
          cause: new CliInputError({
            message: `Unknown ${api} operation "${operation}". Use \`spiko operations ${api}\`.`,
          }),
        })
      }

      const [operationName, metadata] = resolved
      const invocation = yield* prepareInvocation(operationName, metadata, {
        confirm,
        params: Option.getOrElse(params, () => ({})),
        path: Option.getOrElse(path, () => ({})),
        payload,
      })
      const client = yield* getClient(api)
      const result = yield* invokeClient(api, client, operationName, invocation.args)
      yield* Console.log(JSON.stringify(result, null, 2))
    }).pipe(
      Effect.mapError((cause) =>
        CliError.isCliError(cause) ? cause : new CliError.UserError({ cause }),
      ),
    ),
).pipe(Command.withDescription("Call an operation from a generated Spiko API client"))

export const rootCommand = Command.make("spiko").pipe(
  Command.withSubcommands([operationsCommand, callCommand]),
  Command.withDescription(
    "Interact with Spiko's generated Effect HTTP clients. Credentials are read from the environment.",
  ),
)

export const program = Command.run(rootCommand, { version: "0.1.0" })
