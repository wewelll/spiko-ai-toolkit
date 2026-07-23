import { Effect, Schema } from "effect"
import type { OperationMetadata } from "./generated/operations.ts"

export interface InvocationInput {
  readonly confirm: boolean
  readonly params: Readonly<Record<string, unknown>>
  readonly path: Readonly<Record<string, unknown>>
  readonly payload?: unknown
  readonly payloadProvided: boolean
}

export interface PreparedInvocation {
  readonly args: ReadonlyArray<unknown>
  readonly mutating: boolean
}

export class CliInputError extends Schema.TaggedErrorClass<CliInputError>()("CliInputError", {
  message: Schema.String,
}) {}

const has = (record: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

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
    const args: Array<unknown> = []

    for (const parameter of pathParameters) {
      const value = input.path[parameter.name]
      if (!has(input.path, parameter.name) || typeof value !== "string") {
        return yield* new CliInputError({
          message: `--path must contain the string property "${parameter.name}".`,
        })
      }
      args.push(value)
    }

    for (const parameter of requestParameters) {
      if (parameter.required && !has(input.params, parameter.name)) {
        return yield* new CliInputError({
          message: `--params must contain the required property "${parameter.name}".`,
        })
      }
    }

    if (metadata.requestBody?.required === true && !input.payloadProvided) {
      return yield* new CliInputError({
        message: `${operationName} requires --payload with a JSON request body.`,
      })
    }

    const options: {
      params?: Readonly<Record<string, unknown>>
      payload?: unknown
    } = {}

    if (requestParameters.length > 0) {
      options.params = input.params
    }
    if (metadata.requestBody !== undefined && input.payloadProvided) {
      options.payload = input.payload
    }

    args.push(options)
    return { args, mutating }
  })
