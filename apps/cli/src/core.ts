import { Effect, Option, Record, Schema } from "effect"
import type { OperationMetadata } from "./generated/operations.ts"

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

export class CliInputError extends Schema.TaggedError<CliInputError>()("CliInputError", {
  message: Schema.String,
}) {}

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
    const args: Array<unknown> = pathParameters.flatMap((parameter) =>
      Option.toArray(Record.get(input.path, parameter.name)),
    )

    const options: {
      params?: Readonly<Record<string, string>>
      payload?: unknown
    } = {}

    if (requestParameters.length > 0) {
      options.params = input.params
    }
    if (metadata.requestBody !== undefined && Option.isSome(input.payload)) {
      options.payload = input.payload.value
    }

    args.push(options)
    return { args, mutating }
  })
