import * as DistributorApi from "@spiko/distributor-api-client"
import * as InvestorApi from "@spiko/investor-api-client"
import * as PublicApi from "@spiko/public-api-client"
import { Console, Effect, Option, Predicate, Record, Schema } from "effect"
import { Argument, CliError, Command, Flag } from "effect/unstable/cli"
import type { ApiName, OperationMetadata, OperationParameter } from "./generated/operations.ts"
import { ApiNames, OperationCatalog } from "./generated/operations.ts"
import { CliInputError, prepareInvocation } from "./core.ts"
import { routeOperations } from "./routes.ts"

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

  // Dynamic generated methods are untyped here; translate their failure before it escapes.
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context
  return yield* result.pipe(
    Effect.mapError((cause) =>
      CliError.isCliError(cause) ? cause : new CliError.UserError({ cause }),
    ),
  )
})

const makeParameterFlag = (parameter: OperationParameter): Flag.Flag<Option.Option<string>> => {
  const flag = Flag.string(parameter.name).pipe(
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
    Option.match(Option.flatten(Record.get(input, parameter.name)), {
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

const makeOperationCommand = (
  api: ApiName,
  commandName: string,
  operationName: string,
  metadata: OperationMetadata,
) => {
  const parameters = Record.fromIterableWith(metadata.parameters, (parameter) => [
    parameter.name,
    makeParameterFlag(parameter),
  ])
  const description = `${metadata.method} ${metadata.path} — ${metadata.description}`
  const mutating = metadata.method !== "GET" && metadata.method !== "HEAD"

  if (mutating && metadata.requestBody !== undefined) {
    return Command.make(
      commandName,
      { confirm, parameters, payload },
      ({ confirm, parameters, payload }) =>
        handleCliErrors(
          callOperation(api, operationName, metadata, confirm, parameters, Option.some(payload)),
        ),
    ).pipe(Command.withDescription(description))
  }
  if (mutating) {
    return Command.make(commandName, { confirm, parameters }, ({ confirm, parameters }) =>
      handleCliErrors(
        callOperation(api, operationName, metadata, confirm, parameters, Option.none()),
      ),
    ).pipe(Command.withDescription(description))
  }
  if (metadata.requestBody !== undefined) {
    return Command.make(commandName, { parameters, payload }, ({ parameters, payload }) =>
      handleCliErrors(
        callOperation(api, operationName, metadata, false, parameters, Option.some(payload)),
      ),
    ).pipe(Command.withDescription(description))
  }
  return Command.make(commandName, { parameters }, ({ parameters }) =>
    handleCliErrors(callOperation(api, operationName, metadata, false, parameters, Option.none())),
  ).pipe(Command.withDescription(description))
}

const makeResourceCommand = (
  api: ApiName,
  resource: string,
  routes: ReturnType<typeof routeOperations>,
) => {
  const actions = routes.map((route) =>
    makeOperationCommand(api, route.action, route.operationName, route.metadata),
  )
  const defaultRoute = routes.find((route) => route.isDefault)
  const description = `Call ${api} API operations for ${resource}`

  return defaultRoute === undefined
    ? Command.make(resource).pipe(
        Command.withSubcommands(actions),
        Command.withDescription(description),
      )
    : makeOperationCommand(api, resource, defaultRoute.operationName, defaultRoute.metadata).pipe(
        Command.withSubcommands(actions),
        Command.withDescription(description),
      )
}

const makeApiCommand = (api: ApiName) => {
  const routes = routeOperations(OperationCatalog[api])
  const resources = Map.groupBy(routes, (route) => route.resource)

  return Command.make(api).pipe(
    Command.withSubcommands(
      Array.from(resources, ([resource, resourceRoutes]) =>
        makeResourceCommand(api, resource, resourceRoutes),
      ),
    ),
    Command.withDescription(`Call a generated ${api} API operation`),
  )
}

const api = Argument.choice("api", ApiNames).pipe(Argument.withDescription("The Spiko API to use"))

const operationsCommand = Command.make("operations", { api }, ({ api }) => {
  const operations = routeOperations(OperationCatalog[api]).map((route) => ({
    action: route.action,
    command: `spiko call ${api} ${route.resource}${route.isDefault ? "" : ` ${route.action}`}`,
    description: route.metadata.description,
    method: route.metadata.method,
    name: route.operationName,
    path: route.metadata.path,
    resource: route.resource,
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
