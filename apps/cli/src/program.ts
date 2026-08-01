import * as DistributorApi from "@spiko/distributor-api-client"
import * as InvestorApi from "@spiko/investor-api-client"
import * as PublicApi from "@spiko/public-api-client"
import { Console, Effect, Option, Predicate, Record, Schema } from "effect"
import { Argument, CliError, Command, Flag } from "effect/unstable/cli"
import type { ApiName, OperationMetadata, OperationParameter } from "./generated/operations.ts"
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

const parameterFlagName = (parameter: OperationParameter): string =>
  `${parameter.in}-${parameter.name}`

const makeParameterFlag = (parameter: OperationParameter): Flag.Flag<Option.Option<string>> => {
  const flag = Flag.string(parameterFlagName(parameter)).pipe(
    Flag.withDescription(
      `${parameter.required ? "Required" : "Optional"} ${parameter.in} parameter: ${parameter.name}`,
    ),
  )
  return parameter.required ? Flag.map(flag, Option.some) : Flag.optional(flag)
}

const collectParameters = (
  metadata: OperationMetadata,
  input: Readonly<Record<string, Option.Option<string>>>,
) =>
  metadata.parameters.flatMap((parameter) =>
    Option.match(Option.flatten(Record.get(input, parameterFlagName(parameter))), {
      onNone: () => [],
      onSome: (value) => [{ parameter, value }],
    }),
  )

const callOperation = Effect.fn("Cli.callOperation")(function* (
  api: ApiName,
  operationName: string,
  metadata: OperationMetadata,
  confirm: boolean,
  parameters: Readonly<Record<string, Option.Option<string>>>,
  payload: Option.Option<Schema.Json>,
) {
  const present = collectParameters(metadata, parameters)
  const invocation = yield* prepareInvocation(operationName, metadata, {
    confirm,
    params: Record.fromEntries(
      present.flatMap(({ parameter, value }) =>
        parameter.in === "path" ? [] : [[parameter.name, value]],
      ),
    ),
    path: Record.fromEntries(
      present.flatMap(({ parameter, value }) =>
        parameter.in === "path" ? [[parameter.name, value]] : [],
      ),
    ),
    payload,
  })
  const client = yield* getClient(api)
  const result = yield* invokeClient(api, client, operationName, invocation.args)
  yield* Console.log(JSON.stringify(result, null, 2))
})

const handleCliErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      CliError.isCliError(cause) ? cause : new CliError.UserError({ cause }),
    ),
  )

const confirm = Flag.boolean("confirm").pipe(
  Flag.withDescription("Explicitly approve a non-read-only API operation"),
)

const payload = Flag.fileSchema("payload", Schema.Json, { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON request body file"),
)

const makeOperationCommand = (api: ApiName, operationName: string, metadata: OperationMetadata) => {
  const parameters = Record.fromIterableWith(metadata.parameters, (parameter) => [
    parameterFlagName(parameter),
    makeParameterFlag(parameter),
  ])
  const description = `${metadata.method} ${metadata.path} — ${metadata.description}`
  const mutating = metadata.method !== "GET" && metadata.method !== "HEAD"

  if (mutating && metadata.requestBody !== undefined) {
    return Command.make(
      operationName,
      { confirm, parameters, payload },
      ({ confirm, parameters, payload }) =>
        handleCliErrors(
          callOperation(api, operationName, metadata, confirm, parameters, Option.some(payload)),
        ),
    ).pipe(Command.withDescription(description))
  }
  if (mutating) {
    return Command.make(operationName, { confirm, parameters }, ({ confirm, parameters }) =>
      handleCliErrors(
        callOperation(api, operationName, metadata, confirm, parameters, Option.none()),
      ),
    ).pipe(Command.withDescription(description))
  }
  if (metadata.requestBody !== undefined) {
    return Command.make(operationName, { parameters, payload }, ({ parameters, payload }) =>
      handleCliErrors(
        callOperation(api, operationName, metadata, false, parameters, Option.some(payload)),
      ),
    ).pipe(Command.withDescription(description))
  }
  return Command.make(operationName, { parameters }, ({ parameters }) =>
    handleCliErrors(callOperation(api, operationName, metadata, false, parameters, Option.none())),
  ).pipe(Command.withDescription(description))
}

const makeApiCommand = (api: ApiName) =>
  Command.make(api).pipe(
    Command.withSubcommands(
      Object.entries(OperationCatalog[api]).map(([operationName, metadata]) =>
        makeOperationCommand(api, operationName, metadata),
      ),
    ),
    Command.withDescription(`Call a generated ${api} API operation`),
  )

const api = Argument.choice("api", ApiNames).pipe(Argument.withDescription("The Spiko API to use"))

const operationsCommand = Command.make("operations", { api }, ({ api }) => {
  const operations = Object.entries(OperationCatalog[api]).map(([name, metadata]) => ({
    description: metadata.description,
    method: metadata.method,
    name,
    path: metadata.path,
  }))
  return Console.log(JSON.stringify(operations, null, 2))
}).pipe(Command.withDescription("List generated operations for a Spiko API"))

const callCommand = Command.make("call").pipe(
  Command.withSubcommands(ApiNames.map(makeApiCommand)),
  Command.withDescription("Call an operation from a generated Spiko API client"),
)

export const rootCommand = Command.make("spiko").pipe(
  Command.withSubcommands([operationsCommand, callCommand]),
  Command.withDescription(
    "Interact with Spiko's generated Effect HTTP clients. Credentials are read from the environment.",
  ),
)

export const program = Command.run(rootCommand, { version: "0.1.0" })
