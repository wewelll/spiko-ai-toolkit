import { Effect, Option, Record, Schema } from "effect"
import type { OperationMetadata, OperationParameter } from "./generated/operations.ts"

export interface InvocationInput {
  readonly confirm: boolean
  readonly params: Readonly<Record<string, string>>
  readonly path: Readonly<Record<string, string>>
  readonly payload: Option.Option<unknown>
}

export interface PreparedInvocation {
  readonly args: ReadonlyArray<unknown>
  readonly mutating: boolean
}

export class CliInputError extends Schema.TaggedErrorClass<CliInputError>()("CliInputError", {
  message: Schema.String,
}) {}

const validateParameters = Effect.fn("Cli.validateParameters")(function* (
  flag: "--param" | "--path",
  parameters: ReadonlyArray<OperationParameter>,
  values: Readonly<Record<string, string>>,
) {
  const fields = Record.fromIterableWith(parameters, (parameter) => [
    parameter.name,
    parameter.required ? Schema.String : Schema.optionalKey(Schema.String),
  ])
  const schema =
    parameters.length === 0
      ? Schema.Record(Schema.String, Schema.String).check(
          Schema.makeFilter((record) =>
            Record.isEmptyReadonlyRecord(record)
              ? undefined
              : `${flag} is not accepted by this operation`,
          ),
        )
      : Schema.Struct(fields)

  yield* Schema.decodeUnknownEffect(schema)(values, {
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CliInputError({
          message: `${flag} values do not match the operation: ${cause.message}`,
        }),
    ),
  )

  return values
})

export const prepareInvocation = (
  operationName: string,
  metadata: OperationMetadata,
  input: InvocationInput,
): Effect.Effect<PreparedInvocation, CliInputError> =>
  Effect.gen(function* () {
    const mutating = metadata.method !== "GET" && metadata.method !== "HEAD"

    if (mutating && !input.confirm) {
      return yield* new CliInputError({
        message: `${operationName} uses ${metadata.method}. Re-run with --confirm after reviewing the request.`,
      })
    }

    const pathParameters = metadata.parameters.filter((parameter) => parameter.in === "path")
    const requestParameters = metadata.parameters.filter((parameter) => parameter.in !== "path")
    const path = yield* validateParameters("--path", pathParameters, input.path)
    const params = yield* validateParameters("--param", requestParameters, input.params)
    const args: Array<unknown> = yield* Effect.forEach(pathParameters, (parameter) =>
      Record.get(path, parameter.name).pipe(
        Effect.fromOption(
          () =>
            new CliInputError({
              message: `--path is missing ${parameter.name}.`,
            }),
        ),
      ),
    )

    const options: {
      params?: Readonly<Record<string, string>>
      payload?: unknown
    } = {}

    if (requestParameters.length > 0) {
      options.params = params
    }
    if (metadata.requestBody !== undefined) {
      options.payload = yield* Option.match(input.payload, {
        onNone: () =>
          Effect.fail(
            new CliInputError({
              message: `${operationName} requires --payload with a JSON request body file.`,
            }),
          ),
        onSome: Effect.succeed,
      })
    } else if (Option.isSome(input.payload)) {
      return yield* new CliInputError({
        message: `${operationName} does not accept --payload.`,
      })
    }

    args.push(options)
    return { args, mutating }
  })
