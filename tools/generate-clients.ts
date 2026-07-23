#!/usr/bin/env node

import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator"
import { camelize } from "@effect/openapi-generator/Utils"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Cause, Console, Effect, FileSystem, Schema, SchemaTransformation } from "effect"
import * as Command from "effect/unstable/cli/Command"
import * as Flag from "effect/unstable/cli/Flag"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"

interface ApiDefinition {
  readonly id: "distributor" | "investor" | "public"
  readonly clientName: string
  readonly generatedFile: string
  readonly specFile: string
  readonly specUrl: string
}

interface OpenApiParameter {
  readonly $ref?: string
  readonly in?: string
  readonly name?: string
  readonly required?: boolean
}

interface OpenApiOperation {
  readonly description?: string
  readonly operationId?: string
  readonly parameters?: ReadonlyArray<OpenApiParameter>
  readonly requestBody?: {
    readonly required?: boolean
  }
  readonly summary?: string
}

interface OpenApiPath {
  readonly parameters?: ReadonlyArray<OpenApiParameter>
  readonly [method: string]: OpenApiOperation | ReadonlyArray<OpenApiParameter> | undefined
}

interface OpenApiDocument {
  readonly components?: {
    readonly parameters?: Readonly<Record<string, OpenApiParameter>>
  }
  readonly paths: Readonly<Record<string, OpenApiPath>>
}

const apis: ReadonlyArray<ApiDefinition> = [
  {
    id: "public",
    clientName: "SpikoPublicApi",
    generatedFile: "packages/public-api-client/src/generated.ts",
    specFile: "openapi/public-api.json",
    specUrl: "https://public-api.spiko.io/v0/docs/openapi.json",
  },
  {
    id: "investor",
    clientName: "SpikoInvestorApi",
    generatedFile: "packages/investor-api-client/src/generated.ts",
    specFile: "openapi/investor-api.json",
    specUrl: "https://investor-api.spiko.io/v1/docs/openapi.json",
  },
  {
    id: "distributor",
    clientName: "SpikoDistributorApi",
    generatedFile: "packages/distributor-api-client/src/generated.ts",
    specFile: "openapi/distributor-api.json",
    specUrl: "https://distributor-api.spiko.io/v0/docs/openapi.json",
  },
]

const JsonFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, SchemaTransformation.fromJsonString),
)

const parseJson = Schema.decodeUnknownEffect(JsonFromString)

const readSpec = (definition: ApiDefinition, fetch: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    if (!fetch) {
      return yield* fs.readFileString(definition.specFile)
    }

    const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const response = yield* httpClient.get(definition.specUrl)
    const body = yield* response.text
    const parsed = yield* parseJson(body)
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`

    yield* fs.writeFileString(definition.specFile, normalized)
    yield* Console.log(`Updated ${definition.specFile}`)

    return normalized
  })

const generateCatalog = (
  documents: ReadonlyArray<readonly [ApiDefinition, OpenApiDocument]>,
): string => {
  const catalog = Object.fromEntries(
    documents.map(([definition, document]) => {
      const operations: Record<string, unknown> = {}

      for (const [path, pathItem] of Object.entries(document.paths)) {
        for (const method of [
          "delete",
          "get",
          "head",
          "options",
          "patch",
          "post",
          "put",
        ] as const) {
          const operation = pathItem[method]
          if (operation === undefined || Array.isArray(operation)) {
            continue
          }

          const resolvedOperation = operation as OpenApiOperation
          const operationId = resolvedOperation.operationId ?? `${method.toUpperCase()}${path}`
          const parameters = [
            ...(pathItem.parameters ?? []),
            ...(resolvedOperation.parameters ?? []),
          ].map((parameter) => resolveParameter(document, parameter))

          operations[camelize(operationId)] = {
            description: resolvedOperation.description ?? resolvedOperation.summary ?? operationId,
            method: method.toUpperCase(),
            parameters: parameters.flatMap((parameter) =>
              parameter.name === undefined || parameter.in === undefined
                ? []
                : [
                    {
                      in: parameter.in,
                      name: parameter.name,
                      required: parameter.required === true,
                    },
                  ],
            ),
            path,
            requestBody:
              resolvedOperation.requestBody === undefined
                ? undefined
                : { required: resolvedOperation.requestBody.required === true },
          }
        }
      }

      return [definition.id, operations]
    }),
  )

  return `// This file is generated by tools/generate-clients.ts. Do not edit it by hand.

export const ApiNames = ["public", "investor", "distributor"] as const

export type ApiName = (typeof ApiNames)[number]

export interface OperationParameter {
  readonly in: string
  readonly name: string
  readonly required: boolean
}

export interface OperationMetadata {
  readonly description: string
  readonly method: string
  readonly parameters: ReadonlyArray<OperationParameter>
  readonly path: string
  readonly requestBody?: {
    readonly required: boolean
  }
}

export const OperationCatalog = ${JSON.stringify(catalog, null, 2)} as const satisfies Readonly<
  Record<ApiName, Readonly<Record<string, OperationMetadata>>>
>
`
}

const resolveParameter = (
  document: OpenApiDocument,
  parameter: OpenApiParameter,
): OpenApiParameter => {
  if (parameter.$ref === undefined) {
    return parameter
  }

  const prefix = "#/components/parameters/"
  if (!parameter.$ref.startsWith(prefix)) {
    return parameter
  }

  return document.components?.parameters?.[parameter.$ref.slice(prefix.length)] ?? parameter
}

const fetch = Flag.boolean("fetch").pipe(
  Flag.withDescription("Download the latest Spiko specifications before generating clients"),
)

const generate = Command.make("generate-clients", { fetch }, ({ fetch }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const generator = yield* OpenApiGenerator.OpenApiGenerator

    yield* fs.makeDirectory("openapi", { recursive: true })

    const documents = yield* Effect.forEach(apis, (definition) =>
      Effect.gen(function* () {
        const source = yield* readSpec(definition, fetch)
        const spec = yield* parseJson(source)
        const warnings: Array<OpenApiGenerator.OpenApiGeneratorWarning> = []
        const generated = yield* generator.generate(spec as OpenAPISpec, {
          format: "httpclient",
          name: definition.clientName,
          onWarning: (warning) => {
            warnings.push(warning)
          },
        })

        yield* fs.makeDirectory(
          definition.generatedFile.slice(0, definition.generatedFile.lastIndexOf("/")),
          {
            recursive: true,
          },
        )
        yield* fs.writeFileString(
          definition.generatedFile,
          `// This file is generated by tools/generate-clients.ts. Do not edit it by hand.\n\n${generated}`
            .replace(/[ \t]+$/gm, "")
            .trimEnd() + "\n",
        )

        for (const warning of warnings) {
          yield* Console.error(
            `WARNING [${warning.code}] ${warning.method?.toUpperCase() ?? ""} ${warning.path ?? ""}: ${warning.message}`,
          )
        }

        yield* Console.log(`Generated ${definition.generatedFile}`)
        return [definition, spec as OpenApiDocument] as const
      }),
    )

    const catalogFile = "apps/cli/src/generated/operations.ts"
    yield* fs.makeDirectory("apps/cli/src/generated", { recursive: true })
    yield* fs.writeFileString(catalogFile, generateCatalog(documents))
    yield* Console.log(`Generated ${catalogFile}`)
  }),
)

Command.run(generate, { version: "0.1.0" }).pipe(
  Effect.provide(OpenApiGenerator.layerTransformerSchema),
  Effect.provide(NodeHttpClient.layerUndici),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)
