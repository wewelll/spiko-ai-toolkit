import { Cause, Console, Effect, Layer, Schema, Stdio } from "effect"
import { Argument, CliError, Command, Prompt } from "effect/unstable/cli"

export const SpikoFamilies = ["public", "investor", "distributor"] as const

export type SpikoFamily = (typeof SpikoFamilies)[number]

export type HttpMethod = "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE"

export interface OperationParameterDefinition {
  readonly description: string
  readonly flag: string
  readonly in: "cookie" | "header" | "path" | "query"
  readonly name: string
  readonly required: boolean
  readonly schema: Schema.Json
}

export interface OperationResponseDefinition {
  readonly content: ReadonlyArray<{
    readonly mediaType: string
    readonly schema: Schema.Json
  }>
  readonly description: string
  readonly status: string
}

export interface OperationRequestBodyDefinition {
  readonly fields: ReadonlyArray<{
    readonly acceptedExtensions: ReadonlyArray<string>
    readonly file: boolean
    readonly flag: string
    readonly name: string
    readonly required: boolean
    readonly schema: Schema.Json
  }>
  readonly kind: "json" | "multipart"
  readonly mediaType: string
  readonly required: boolean
  readonly schema: Schema.Json
}

export interface OperationDefinition {
  readonly action: string
  readonly description: string
  readonly family: SpikoFamily
  readonly method: HttpMethod
  readonly operationId: string
  readonly parameters: ReadonlyArray<OperationParameterDefinition>
  readonly path: string
  readonly requestBody: OperationRequestBodyDefinition | null
  readonly resource: string
  readonly responses: ReadonlyArray<OperationResponseDefinition>
  readonly safety: "mutation" | "read"
}

export interface DefineOperationOptions<
  Config extends Command.Command.Config,
  Definition extends OperationDefinition,
  Prepared,
  InputError,
  InputRequirements,
  RemoteError,
  RemoteRequirements,
> {
  readonly confirmed: (input: Command.Command.Config.Infer<Config>) => boolean
  readonly definition: Definition
  readonly invoke: (input: Prepared) => Effect.Effect<unknown, RemoteError, RemoteRequirements>
  readonly parameters: Config
  readonly prepare: (
    input: Command.Command.Config.Infer<Config>,
  ) => Effect.Effect<Prepared, InputError, InputRequirements>
}

interface ProvidedOperation<Input, E, R> {
  readonly command: Command.Command<string, Input, {}, E, R>
  readonly definition: OperationDefinition
}

export interface DefinedOperation<
  Family extends SpikoFamily = SpikoFamily,
  RemoteRequirements = never,
  InputRequirements = never,
  CommandInput = never,
> {
  readonly command: Command.Command<
    string,
    CommandInput,
    {},
    OperationFailure | OperationInputFailure,
    InputRequirements | RemoteRequirements
  >
  readonly definition: OperationDefinition & { readonly family: Family }
  readonly provide: <LayerError, LayerRequirements>(
    layer: Layer.Layer<RemoteRequirements, LayerError, LayerRequirements>,
  ) => ProvidedOperation<
    CommandInput,
    OperationFailure | OperationInputFailure,
    InputRequirements | LayerRequirements
  >
}

class OperationFailure extends Schema.TaggedError<OperationFailure>()("OperationFailure", {
  cause: Schema.Defect(),
  operation: Schema.String,
}) {}

class OperationInputFailure extends Schema.TaggedError<OperationInputFailure>()(
  "OperationInputFailure",
  {
    cause: Schema.Defect(),
    operation: Schema.String,
  },
) {}

const renderSuccess = (operation: string, data: unknown) =>
  Console.log(
    JSON.stringify(
      {
        data: data ?? null,
        ok: true,
        operation,
      },
      null,
      2,
    ),
  )

export const defineOperation = <
  const Config extends Command.Command.Config,
  const Definition extends OperationDefinition,
  Prepared,
  InputError,
  InputRequirements,
  RemoteError,
  RemoteRequirements,
>(
  options: DefineOperationOptions<
    Config,
    Definition,
    Prepared,
    InputError,
    InputRequirements,
    RemoteError,
    RemoteRequirements
  >,
): DefinedOperation<
  Definition["family"],
  RemoteRequirements,
  InputRequirements,
  Command.Command.Config.Infer<Config>
> => {
  const makeCommand = <InvocationError, InvocationRequirements>(
    invoke: (input: Prepared) => Effect.Effect<unknown, InvocationError, InvocationRequirements>,
  ) => {
    const execute = (input: Command.Command.Config.Infer<Config>) =>
      Effect.gen(function* () {
        if (options.definition.safety === "mutation" && !options.confirmed(input)) {
          return yield* Effect.fail(
            new OperationInputFailure({
              cause: new CliError.InvalidValue({
                expected: "--confirm for a mutating Spiko Operation",
                kind: "flag",
                option: "confirm",
                value: "false",
              }),
              operation: options.definition.operationId,
            }),
          )
        }
        const prepared = yield* options.prepare(input).pipe(
          Effect.mapError(
            (cause) =>
              new OperationInputFailure({
                cause,
                operation: options.definition.operationId,
              }),
          ),
        )
        const data = yield* invoke(prepared).pipe(
          Effect.mapError(
            (cause) =>
              new OperationFailure({
                cause,
                operation: options.definition.operationId,
              }),
          ),
        )
        yield* renderSuccess(options.definition.operationId, data)
      })
    const description = `${options.definition.method} ${options.definition.path} — ${options.definition.description}`

    return Command.make(options.definition.action, options.parameters, execute).pipe(
      Command.withDescription(description),
    )
  }

  return {
    command: makeCommand(options.invoke),
    definition: options.definition,
    provide: (layer) => ({
      command: makeCommand((input) => options.invoke(input).pipe(Effect.provide(layer))),
      definition: options.definition,
    }),
  }
}

const listItem = (definition: OperationDefinition) => ({
  action: definition.action,
  command: `spiko call ${definition.family} ${definition.resource} ${definition.action}`,
  description: definition.description,
  method: definition.method,
  operationId: definition.operationId,
  path: definition.path,
  resource: definition.resource,
})

const makeOperationsCommand = (definitions: ReadonlyArray<OperationDefinition>) => {
  const family = Argument.choice("family", SpikoFamilies).pipe(
    Argument.withDescription("The Spiko Operation family to inspect"),
  )

  const list = Command.make("list", { family }, ({ family }) =>
    renderSuccess(
      "operations.list",
      definitions.filter((definition) => definition.family === family).map(listItem),
    ),
  ).pipe(Command.withDescription("List generated Spiko Operations"))

  const operationId = Argument.string("operation-id").pipe(
    Argument.withDescription("The exact OpenAPI operationId to describe"),
  )
  const describe = Command.make("describe", { family, operationId }, ({ family, operationId }) => {
    const definition = definitions.find(
      (candidate) => candidate.family === family && candidate.operationId === operationId,
    )
    return definition === undefined
      ? Effect.fail(
          new CliError.InvalidValue({
            expected: `an OpenAPI operationId in the ${family} family`,
            kind: "argument",
            option: "operation-id",
            value: operationId,
          }),
        )
      : renderSuccess("operations.describe", definition)
  }).pipe(Command.withDescription("Describe one generated Spiko Operation"))

  return Command.make("operations").pipe(
    Command.withSubcommands([list, describe]),
    Command.withDescription("Inspect the generated Operation Catalog"),
  )
}

const failureCode = (cause: unknown): "invalid-command" | "invalid-input" | "remote-failure" => {
  if (cause instanceof OperationInputFailure) {
    return "invalid-input"
  }
  if (cause instanceof OperationFailure || !CliError.isCliError(cause)) {
    return "remote-failure"
  }
  if (cause._tag !== "ShowHelp") {
    return cause._tag === "UserError" ? "remote-failure" : "invalid-input"
  }
  return cause.errors.some((error) => error._tag === "UnknownSubcommand")
    ? "invalid-command"
    : "invalid-input"
}

const failureMessage = (cause: unknown): string => {
  if (cause instanceof OperationFailure || cause instanceof OperationInputFailure) {
    return failureMessage(cause.cause)
  }
  if (!CliError.isCliError(cause)) {
    return cause instanceof Error ? cause.message : String(cause)
  }
  return cause._tag === "ShowHelp" && cause.errors.length > 0
    ? cause.errors.map((error) => error.message).join("\n")
    : cause.message
}

const operationForFailure = (
  cause: unknown,
  definitions: ReadonlyArray<OperationDefinition>,
): string => {
  if (cause instanceof OperationFailure || cause instanceof OperationInputFailure) {
    return cause.operation
  }
  if (!CliError.isCliError(cause) || cause._tag !== "ShowHelp") {
    return "cli"
  }
  const [, command, family, resource, action] = cause.commandPath
  if (command !== "call") {
    return "cli"
  }
  return (
    definitions.find(
      (definition) =>
        definition.family === family &&
        definition.resource === resource &&
        definition.action === action,
    )?.operationId ?? "cli"
  )
}

const renderFailure = (
  console: Console.Console,
  cause: unknown,
  definitions: ReadonlyArray<OperationDefinition>,
): number => {
  const code = failureCode(cause)
  console.error(
    JSON.stringify(
      {
        error: {
          code,
          details: [],
          message: failureMessage(cause),
        },
        ok: false,
        operation: operationForFailure(cause, definitions),
      },
      null,
      2,
    ),
  )
  return code === "remote-failure" ? 1 : 2
}

const makeFamilyCommand = <Input, E, R>(
  family: SpikoFamily,
  operations: ReadonlyArray<ProvidedOperation<Input, E, R>>,
) => {
  if (operations.length === 0) {
    return undefined
  }
  const resources = Array.from(
    Map.groupBy(operations, (operation) => operation.definition.resource),
    ([resource, resourceOperations]) =>
      Command.make(resource).pipe(
        Command.withSubcommands(resourceOperations.map((operation) => operation.command)),
        Command.withDescription(`Invoke ${family} ${resource} Spiko Operations`),
      ),
  )
  return Command.make(family).pipe(
    Command.withSubcommands(resources),
    Command.withDescription(`Invoke ${family} Spiko Operations`),
  )
}

const makeCallCommand = <
  PublicInput,
  PublicError,
  PublicRequirements,
  InvestorInput,
  InvestorError,
  InvestorRequirements,
  DistributorInput,
  DistributorError,
  DistributorRequirements,
>(operations: {
  readonly distributor: ReadonlyArray<
    ProvidedOperation<DistributorInput, DistributorError, DistributorRequirements>
  >
  readonly investor: ReadonlyArray<
    ProvidedOperation<InvestorInput, InvestorError, InvestorRequirements>
  >
  readonly public: ReadonlyArray<ProvidedOperation<PublicInput, PublicError, PublicRequirements>>
}) => {
  const families = [
    makeFamilyCommand("public", operations.public),
    makeFamilyCommand("investor", operations.investor),
    makeFamilyCommand("distributor", operations.distributor),
  ].filter((command) => command !== undefined)

  return Command.make("call").pipe(
    Command.withSubcommands(families),
    Command.withDescription("Invoke a generated Spiko Operation"),
  )
}

export const makeCli = <
  PublicRemoteRequirements,
  PublicInputRequirements,
  PublicLayerError,
  PublicLayerRequirements,
  InvestorRemoteRequirements,
  InvestorInputRequirements,
  InvestorLayerError,
  InvestorLayerRequirements,
  DistributorRemoteRequirements,
  DistributorInputRequirements,
  DistributorLayerError,
  DistributorLayerRequirements,
>(options: {
  readonly operationLayers: {
    readonly distributor: Layer.Layer<
      DistributorRemoteRequirements,
      DistributorLayerError,
      DistributorLayerRequirements
    >
    readonly investor: Layer.Layer<
      InvestorRemoteRequirements,
      InvestorLayerError,
      InvestorLayerRequirements
    >
    readonly public: Layer.Layer<
      PublicRemoteRequirements,
      PublicLayerError,
      PublicLayerRequirements
    >
  }
  readonly operations: {
    readonly distributor: ReadonlyArray<
      DefinedOperation<
        "distributor",
        DistributorRemoteRequirements,
        DistributorInputRequirements,
        never
      >
    >
    readonly investor: ReadonlyArray<
      DefinedOperation<"investor", InvestorRemoteRequirements, InvestorInputRequirements, never>
    >
    readonly public: ReadonlyArray<
      DefinedOperation<"public", PublicRemoteRequirements, PublicInputRequirements, never>
    >
  }
  readonly version: string
}) => {
  const { operationLayers, operations, version } = options
  const definitions = [...operations.public, ...operations.investor, ...operations.distributor].map(
    (operation) => operation.definition,
  )
  const operationsCommand = makeOperationsCommand(definitions)
  const callCommand = makeCallCommand({
    distributor: operations.distributor.map((operation) =>
      operation.provide(operationLayers.distributor),
    ),
    investor: operations.investor.map((operation) => operation.provide(operationLayers.investor)),
    public: operations.public.map((operation) => operation.provide(operationLayers.public)),
  })
  const rootCommand = Command.make("spiko").pipe(
    Command.withSubcommands([operationsCommand, callCommand]),
    Command.withDescription("Discover and invoke Spiko Operations"),
  )

  const run = (args: ReadonlyArray<string>) =>
    Console.consoleWith((console) => {
      const buffered: Array<(console: Console.Console) => void> = []
      const bufferedConsole: Console.Console = Object.assign(Object.create(console), {
        error: (...values: ReadonlyArray<unknown>) => {
          buffered.push((target) => target.error(...values))
        },
        log: (...values: ReadonlyArray<unknown>) => {
          buffered.push((target) => target.log(...values))
        },
      })
      const flush = Effect.sync(() => {
        for (const write of buffered) {
          write(console)
        }
      })

      const execute = (commandArgs: ReadonlyArray<string>) =>
        Command.runWith(rootCommand, {
          renderErrors: false,
          version,
        })(commandArgs).pipe(
          Effect.provideService(Console.Console, bufferedConsole),
          Effect.matchEffect({
            onFailure: (cause) =>
              CliError.isCliError(cause) && cause._tag === "ShowHelp" && cause.errors.length === 0
                ? flush.pipe(Effect.as(0))
                : Effect.sync(() => renderFailure(console, cause, definitions)),
            onSuccess: () => flush.pipe(Effect.as(0)),
          }),
        )

      const wizardRequested = args.some(
        (argument) => argument === "--wizard" || argument.startsWith("--wizard="),
      )
      if (!wizardRequested) {
        return execute(args)
      }

      return Effect.flatMap(Stdio.Stdio, (stdio) =>
        Effect.all([stdio.stdinIsTerminal, stdio.stdoutIsTerminal]).pipe(
          Effect.flatMap(([stdinIsTerminal, stdoutIsTerminal]) => {
            if (stdinIsTerminal && stdoutIsTerminal) {
              return Effect.gen(function* () {
                const wizardArgs = yield* Command.wizard(rootCommand)
                yield* Console.log(`Command: ${wizardArgs.join(" ")}`)
                const shouldRun = yield* Prompt.run(
                  Prompt.toggle({
                    active: "yes",
                    inactive: "no",
                    initial: true,
                    message: "Run this command?",
                  }),
                )
                return shouldRun ? yield* execute(wizardArgs.slice(1)) : 0
              }).pipe(
                Effect.catchTag("QuitError", () => Effect.succeed(130)),
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause) ? Effect.succeed(130) : Effect.failCause(cause),
                ),
              )
            }
            return Effect.sync(() => {
              console.error(
                JSON.stringify(
                  {
                    error: {
                      code: "wizard-requires-terminal",
                      details: [],
                      message: "The wizard requires interactive stdin and stdout.",
                    },
                    ok: false,
                    operation: "cli",
                  },
                  null,
                  2,
                ),
              )
              return 2
            })
          }),
        ),
      )
    })

  return { rootCommand, run }
}
