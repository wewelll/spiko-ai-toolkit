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

export interface OperationDefinition {
  readonly action: string
  readonly description: string
  readonly family: SpikoFamily
  readonly method: HttpMethod
  readonly operationId: string
  readonly parameters: ReadonlyArray<OperationParameterDefinition>
  readonly path: string
  readonly requestBody: Schema.Json | null
  readonly resource: string
  readonly safety: "mutation" | "read"
}

export interface DefineOperationOptions<Config extends Command.Command.Config, E, R> {
  readonly definition: OperationDefinition
  readonly invoke: (input: Command.Command.Config.Infer<Config>) => Effect.Effect<unknown, E, R>
  readonly parameters: Config
}

export interface DefinedOperation<E = never, R = never> {
  readonly command: Command.Command<string, never, {}, E, R>
  readonly definition: OperationDefinition
}

class OperationFailure extends Schema.TaggedError<OperationFailure>()("OperationFailure", {
  cause: Schema.Defect(),
  operation: Schema.String,
}) {}

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

export const defineOperation = <const Config extends Command.Command.Config, E, R>(
  options: DefineOperationOptions<Config, E, R>,
) => {
  const command = Command.make(options.definition.action, options.parameters, (input) =>
    options.invoke(input).pipe(
      Effect.mapError(
        (cause) =>
          new OperationFailure({
            cause,
            operation: options.definition.operationId,
          }),
      ),
      Effect.flatMap((data) => renderSuccess(options.definition.operationId, data)),
    ),
  ).pipe(
    Command.withDescription(
      `${options.definition.method} ${options.definition.path} — ${options.definition.description}`,
    ),
  )

  return {
    command,
    definition: options.definition,
  } satisfies DefinedOperation<Command.Error<typeof command>, Command.Services<typeof command>>
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
  if (cause instanceof OperationFailure) {
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
  if (cause instanceof OperationFailure) {
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

const makeCallCommand = <E, R>(
  operations: ReadonlyArray<DefinedOperation<E, R>>,
): Command.Command<"call", {}, {}, E, R> => {
  const families = Array.from(
    Map.groupBy(operations, (operation) => operation.definition.family),
    ([family, familyOperations]) => {
      const resources = Array.from(
        Map.groupBy(familyOperations, (operation) => operation.definition.resource),
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
    },
  )

  return Command.make("call").pipe(
    Command.withSubcommands(families),
    Command.withDescription("Invoke a generated Spiko Operation"),
  )
}

export const makeCli = <E, R, LayerError, LayerRequirements>(options: {
  readonly operationLayer: Layer.Layer<R, LayerError, LayerRequirements>
  readonly operations: ReadonlyArray<DefinedOperation<E, R>>
  readonly version: string
}) => {
  const { operationLayer, operations, version } = options
  const operationsCommand = makeOperationsCommand(
    operations.map((operation) => operation.definition),
  )
  const callCommand = makeCallCommand(operations).pipe(Command.provide(operationLayer))
  const rootCommand = Command.make("spiko").pipe(
    Command.withSubcommands([operationsCommand, callCommand]),
    Command.withDescription("Discover and invoke Spiko Operations"),
  )

  const definitions = operations.map((operation) => operation.definition)
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
