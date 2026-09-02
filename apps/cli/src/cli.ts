import { Cause, Console, Effect, FileSystem, Layer, Path, Schema, Stdio } from "effect"
import {
  Argument,
  CliConfig,
  CliError,
  Command,
  Flag,
  GlobalFlag,
  Prompt,
} from "effect/unstable/cli"
import {
  type EnvironmentVariables,
  AgentMode,
  extractAgentFlags,
  resolveAgentMode,
} from "./agent-mode.ts"
import { buildAgentSchema, summarizeDefinition } from "./agent-schema.ts"

export const SpikoFamilies = ["public", "investor", "distributor"] as const

export type SpikoFamily = (typeof SpikoFamilies)[number]

// Only methods with a supported safety classification and route action.
export type HttpMethod = "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT"

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
  readonly definition: OperationDefinition & { readonly family: Family }
  readonly provide: <LayerError, LayerRequirements>(
    layer: Layer.Layer<RemoteRequirements, LayerError, LayerRequirements>,
  ) => ProvidedOperation<
    CommandInput,
    OperationFailure | OperationInputFailure | OperationInternalFailure,
    InputRequirements | LayerRequirements
  >
}

class OperationFailure extends Schema.TaggedError<OperationFailure>()("OperationFailure", {
  cause: Schema.Defect(),
  operation: Schema.String,
}) {}

class OperationInternalFailure extends Schema.TaggedError<OperationInternalFailure>()(
  "OperationInternalFailure",
  {
    cause: Schema.Defect(),
    operation: Schema.String,
  },
) {}

class OperationInputFailure extends Schema.TaggedError<OperationInputFailure>()(
  "OperationInputFailure",
  {
    cause: Schema.Defect(),
    operation: Schema.String,
  },
) {}

const invalidPayload = (expected: string, value: string) =>
  new CliError.InvalidValue({
    expected,
    kind: "flag",
    option: "payload",
    value,
  })

const invalidFile = (expected: string, value: string) =>
  new CliError.InvalidValue({
    expected,
    kind: "flag",
    option: "file",
    value,
  })

// Generated prepare closures call these helpers so request bodies are rejected
// locally, before any client acquisition or invocation.
export const readJsonPayload = <S extends Schema.Constraint>(file: string, schema: S) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const source = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError(() => invalidPayload("a readable JSON payload file", file)))
    const json = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(source).pipe(
      Effect.mapError(() => invalidPayload("valid JSON", file)),
    )
    const decoded = yield* Schema.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError(() => invalidPayload("JSON matching the OpenAPI request schema", file)),
    )
    return yield* Schema.encodeEffect(schema)(decoded).pipe(
      Effect.mapError(() => invalidPayload("an encodable OpenAPI request payload", file)),
    )
  })

export const readMultipartFile = (file: string, acceptedExtensions: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path
    const extension = paths.extname(file).slice(1).toLowerCase()
    if (!acceptedExtensions.includes(extension)) {
      return yield* Effect.fail(
        invalidFile(`a file with one of these extensions: ${acceptedExtensions.join(", ")}`, file),
      )
    }
    const bytes = yield* fs
      .readFile(file)
      .pipe(Effect.mapError(() => invalidFile("a readable file", file)))
    return new File([bytes], paths.basename(file))
  })

/**
 * Injected into every agent-mode envelope so an LLM authoring a script for
 * later human execution knows the envelope will not exist in that context.
 */
const AGENT_ENVELOPE_NOTE =
  "This envelope (data/ok/operation/metadata) only appears in agent mode. If you are writing a script the user will run outside this agent session, append --no-agent so its output matches what they will see."

// Binary payloads cannot be printed as raw JSON in either mode, so both keep
// this representation; everything else prints as the bare payload outside
// agent mode.
const toPayload = (data: unknown) =>
  data instanceof Uint8Array
    ? { encoding: "base64", value: Buffer.from(data).toString("base64") }
    : (data ?? null)

/**
 * Render one successful invocation to stdout.
 *
 * Agent mode wraps the payload in a `{data, ok, operation, metadata}`
 * envelope whose metadata carries the invoked command path, the
 * payload count for arrays, and the script-authoring note. Outside agent mode
 * the raw payload is printed so scripts and pipelines see exactly what the
 * API returned.
 */
const renderSuccess = (operation: string, commandPath: ReadonlyArray<string>, data: unknown) =>
  Effect.gen(function* () {
    const agentMode = yield* AgentMode
    const payload = toPayload(data)
    if (!agentMode) {
      yield* Console.log(JSON.stringify(payload, null, 2))
      return
    }
    yield* Console.log(
      JSON.stringify(
        {
          data: payload,
          metadata: {
            command: commandPath.join(" "),
            ...(Array.isArray(payload) ? { count: payload.length } : {}),
            note: AGENT_ENVELOPE_NOTE,
          },
          ok: true,
          operation,
        },
        null,
        2,
      ),
    )
  })

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
    const invocationFailure = (
      cause: Cause.Cause<OperationFailure>,
    ): Effect.Effect<never, OperationFailure | OperationInternalFailure> => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause)
      }
      // Squash returns die-only defects rather than throwing in the pinned Effect v4 beta.
      const failure = Cause.squash(cause)
      return failure instanceof OperationFailure
        ? Effect.fail(failure)
        : Effect.fail(
            new OperationInternalFailure({
              cause: failure,
              operation: options.definition.operationId,
            }),
          )
    }
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
          Effect.catchCause(invocationFailure),
        )
        yield* renderSuccess(
          options.definition.operationId,
          [
            "call",
            options.definition.family,
            options.definition.resource,
            options.definition.action,
          ],
          data,
        )
      })
    const description = `${options.definition.method} ${options.definition.path} — ${options.definition.description}`

    return Command.make(options.definition.action, options.parameters, execute).pipe(
      Command.withDescription(description),
    )
  }

  return {
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
      ["operations", "list"],
      definitions.filter((definition) => definition.family === family).map(listItem),
    ),
  ).pipe(Command.withDescription("List generated Spiko Operations"))

  const operationId = Argument.string("operation-id").pipe(
    Argument.withDescription("The exact OpenAPI operationId to describe"),
  )
  const summary = Flag.boolean("summary").pipe(
    Flag.withDescription("Omit request and response JSON Schemas for a token-light description"),
  )
  const describe = Command.make(
    "describe",
    { family, operationId, summary },
    ({ family, operationId, summary }) => {
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
        : renderSuccess(
            "operations.describe",
            ["operations", "describe"],
            summary ? summarizeDefinition(definition) : definition,
          )
    },
  ).pipe(Command.withDescription("Describe one generated Spiko Operation"))

  return Command.make("operations").pipe(
    Command.withSubcommands([list, describe]),
    Command.withDescription("Inspect the generated Operation Catalog"),
  )
}

/**
 * Remediation hints derived from the failure cause, appended to every error
 * envelope so agents can self-correct without another discovery round-trip.
 */
const failureSuggestions = (
  cause: unknown,
  definitions: ReadonlyArray<OperationDefinition>,
): Array<string> => {
  if (
    cause instanceof OperationFailure ||
    cause instanceof OperationInputFailure ||
    cause instanceof OperationInternalFailure
  ) {
    return failureSuggestions(cause.cause, definitions)
  }
  if (CliError.isCliError(cause)) {
    if (cause._tag === "ShowHelp") {
      // Recurse into the child parse errors, then re-add the describe hint
      // resolved from THIS error's commandPath — child errors carry no path,
      // so without this the hint would fall back to "cli" and lose the
      // operation-specific pointer.
      return [
        ...cause.errors.flatMap((error) => failureSuggestions(error, definitions)),
        ...describeHint(cause, definitions),
      ]
    }
    if (cause._tag === "UnrecognizedOption") {
      return unique([
        ...cause.suggestions.map((suggestion) => `Did you mean ${suggestion}?`),
        "Run 'spiko agent schema' to list commands and flags.",
      ])
    }
    if (cause._tag === "UnknownSubcommand") {
      return unique([
        ...cause.suggestions.map((suggestion) => `Did you mean '${suggestion}'?`),
        "Run 'spiko agent schema' to list commands and flags.",
      ])
    }
    if (cause._tag === "MissingOption") {
      const flag = cause.option.startsWith("-") ? cause.option : `--${cause.option}`
      return [`Supply the required flag ${flag}.`, ...describeHint(cause, definitions)]
    }
    if (cause._tag === "MissingArgument") {
      return [
        `Supply the required argument <${cause.argument}>.`,
        "Run 'spiko agent schema' to list commands and arguments.",
      ]
    }
    if (cause._tag === "InvalidValue") {
      if (cause.option === "confirm") {
        return ["Re-run with --confirm to allow this mutating Spiko Operation."]
      }
      if (cause.option === "operation-id") {
        return ["Run 'spiko operations list <family>' to see valid operationIds."]
      }
      // Positional arguments are not flags; word the hint accordingly.
      const target = cause.kind === "argument" ? `<${cause.option}>` : `--${cause.option}`
      return [`Provide ${cause.expected} for ${target}.`, ...describeHint(cause, definitions)]
    }
  }
  return []
}

const unique = (values: ReadonlyArray<string>): Array<string> => [...new Set(values)]

/** Point at the described operation when the failing command maps to one. */
const describeHint = (
  cause: unknown,
  definitions: ReadonlyArray<OperationDefinition>,
): Array<string> => {
  const candidates = definitions.find(
    (definition) => definition.operationId === operationForFailure(cause, definitions),
  )
  return candidates === undefined
    ? []
    : [
        `Run 'spiko operations describe ${candidates.family} "${candidates.operationId}"' for exact input requirements.`,
      ]
}

const failureCode = (
  cause: unknown,
): "internal-failure" | "invalid-command" | "invalid-input" | "remote-failure" => {
  if (cause instanceof OperationInputFailure) {
    return "invalid-input"
  }
  if (cause instanceof OperationInternalFailure) {
    return "internal-failure"
  }
  if (cause instanceof OperationFailure) {
    return "remote-failure"
  }
  if (!CliError.isCliError(cause)) {
    return "internal-failure"
  }
  if (cause._tag !== "ShowHelp") {
    return "invalid-input"
  }
  return cause.errors.some((error) => error._tag === "UnknownSubcommand")
    ? "invalid-command"
    : "invalid-input"
}

const failureMessage = (cause: unknown): string => {
  if (cause instanceof OperationInternalFailure) {
    return "Internal CLI failure."
  }
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
  if (
    cause instanceof OperationFailure ||
    cause instanceof OperationInputFailure ||
    cause instanceof OperationInternalFailure
  ) {
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
  const suggestions = unique(failureSuggestions(cause, definitions))
  console.error(
    JSON.stringify(
      {
        error: {
          code,
          details: [],
          message: failureMessage(cause),
          ...(suggestions.length > 0 ? { suggestions } : {}),
        },
        ok: false,
        operation: operationForFailure(cause, definitions),
      },
      null,
      2,
    ),
  )
  return code === "remote-failure" || code === "internal-failure" ? 1 : 2
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
  const agentSchemaCommand = Command.make(
    "schema",
    {
      compact: Flag.boolean("compact").pipe(
        Flag.withDescription("Emit command names and flags only, without descriptions"),
      ),
    },
    ({ compact }) =>
      renderSuccess(
        "agent.schema",
        ["agent", "schema"],
        buildAgentSchema(definitions, { compact, version }),
      ),
  ).pipe(
    Command.withDescription("Emit a machine-readable schema of every Spiko command for AI agents"),
  )
  const agentCommand = Command.make("agent").pipe(
    Command.withSubcommands([agentSchemaCommand]),
    Command.withDescription("Machine-readable discovery output for AI agents"),
  )
  const rootCommand = Command.make("spiko").pipe(
    Command.withSubcommands([operationsCommand, callCommand, agentCommand]),
    Command.withDescription("Discover and invoke Spiko Operations"),
  )

  // Agent-aware replacement for the built-in --help action: identical flag
  // grammar, but when AgentMode is on it renders a scoped JSON schema instead
  // of text help. The action succeeds normally, so the buffered-console flush
  // path emits its output.
  const agentAwareHelp = GlobalFlag.action({
    flag: Flag.boolean("help").pipe(
      Flag.withAlias("h"),
      Flag.withDescription("Show help information"),
    ),
    run: (value, context) =>
      Effect.gen(function* () {
        const agentMode = yield* AgentMode
        if (!agentMode) {
          yield* GlobalFlag.Help.run(value, context)
          return
        }
        yield* Console.log(
          JSON.stringify(
            buildAgentSchema(definitions, { path: context.commandPath.slice(1), version }),
            null,
            2,
          ),
        )
      }),
  })
  const cliConfig = CliConfig.make({
    builtIns: [
      agentAwareHelp,
      GlobalFlag.Version,
      GlobalFlag.Wizard,
      GlobalFlag.Completions,
      GlobalFlag.LogLevel,
    ],
  })

  const run = (rawArgs: ReadonlyArray<string>, options?: { readonly env?: EnvironmentVariables }) =>
    Console.consoleWith((console) => {
      // Agent-mode flags are stripped before grammar parsing; the resolved
      // mode is published through the AgentMode reference so every handler
      // renders output consistently. The environment source is injectable so
      // tests stay deterministic regardless of the host shell.
      const { args, explicit } = extractAgentFlags(rawArgs)
      // Effect v4 invokes flatMap callbacks as (value, fiber); an optional
      // positional env parameter would silently capture that fiber, so the
      // test seam is an options object instead.
      const agentMode = resolveAgentMode(explicit, options?.env ?? process.env)
      const showAgentSchema = (commandPath: ReadonlyArray<string>): Effect.Effect<number> =>
        Effect.sync(() => {
          console.log(
            JSON.stringify(
              buildAgentSchema(definitions, { path: commandPath.slice(1), version }),
              null,
              2,
            ),
          )
          return 0
        })
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
          Effect.provideService(AgentMode, agentMode),
          Effect.provideService(CliConfig.CliConfig, cliConfig),
          Effect.provideService(Console.Console, bufferedConsole),
          Effect.matchCauseEffect({
            onFailure: (cause) => {
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.failCause(cause)
              }
              const failure = Cause.squash(cause)
              if (
                CliError.isCliError(failure) &&
                failure._tag === "ShowHelp" &&
                failure.errors.length === 0
              ) {
                // In agent mode structured JSON help replaces rendered text;
                // the buffered text help is intentionally discarded.
                return agentMode ? showAgentSchema(failure.commandPath) : flush.pipe(Effect.as(0))
              }
              return Effect.sync(() => renderFailure(console, failure, definitions))
            },
            onSuccess: () => flush.pipe(Effect.as(0)),
          }),
        )

      const wizardRequested = rawArgs.some(
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
