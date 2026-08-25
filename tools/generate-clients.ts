#!/usr/bin/env node

import { camelize } from "@effect/openapi-generator/Utils"
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator"
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Cause, Console, Effect, FileSystem, Schema } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import {
  correctedBinaryResponseOperations,
  fixGeneratedClient,
  type GeneratedClientFamily,
} from "./fix-generated-client.ts"
import { generateCliFiles } from "./generate-cli.ts"

const apis = [
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
] as const

type ApiDefinition = (typeof apis)[number]

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

const httpMethods = ["delete", "get", "head", "options", "patch", "post", "put", "trace"] as const

// The OpenAPI generator cannot decode binary success payloads, so any Operation
// declaring a non-JSON 2xx response needs a manual correction in
// tools/fix-generated-client.ts. Derive the expected set from the committed
// spec so newly added binary Operations fail generation instead of silently
// succeeding with void.
const binarySuccessOperations = (document: OpenAPISpec): ReadonlySet<string> => {
  const operations = new Set<string>()
  for (const item of Object.values(document.paths)) {
    for (const method of httpMethods) {
      const operation = item[method]
      if (operation === undefined) {
        continue
      }
      const hasBinarySuccess = Object.entries(operation.responses).some(
        ([status, response]) =>
          status.startsWith("2") &&
          response.content !== undefined &&
          Object.keys(response.content).some((mediaType) => mediaType !== "application/json"),
      )
      if (hasBinarySuccess) {
        operations.add(camelize(operation.operationId))
      }
    }
  }
  return operations
}

const assertBinaryCorrectionsCoverSpec = (family: GeneratedClientFamily, document: OpenAPISpec) => {
  const expected = binarySuccessOperations(document)
  const corrected = correctedBinaryResponseOperations[family]
  const uncorrected = [...expected].filter((operationId) => !corrected.has(operationId))
  if (uncorrected.length > 0) {
    throw new Error(
      `${family}: binary success responses without a generated client correction: ${uncorrected.join(", ")}. Extend tools/fix-generated-client.ts.`,
    )
  }
  const stale = [...corrected].filter((operationId) => !expected.has(operationId))
  if (stale.length > 0) {
    throw new Error(
      `${family}: corrections for Operations without a binary success response: ${stale.join(", ")}. Remove them from tools/fix-generated-client.ts.`,
    )
  }
}

const generatedClientMethods = (source: string): ReadonlySet<string> =>
  new Set(
    Array.from(source.matchAll(/^\s*readonly "([^"]+)": <Config/gm), (match) => match[1]).filter(
      (method): method is string => method !== undefined,
    ),
  )

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
        const json = yield* parseJson(source)
        // The generator's own CLI uses this boundary cast: it accepts external OpenAPI
        // documents but does not currently export a runtime Schema for OpenAPISpec.
        const spec = json as unknown as OpenAPISpec
        assertBinaryCorrectionsCoverSpec(definition.id, spec)
        const warnings: Array<OpenApiGenerator.OpenApiGeneratorWarning> = []
        const generated = yield* generator.generate(spec, {
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
        const fixed = fixGeneratedClient(definition.id, generated)
        yield* fs.writeFileString(
          definition.generatedFile,
          `// This file is generated by tools/generate-clients.ts. Do not edit it by hand.\n\n${fixed}`
            .replace(/[ \t]+$/gm, "")
            .trimEnd() + "\n",
        )

        for (const warning of warnings) {
          yield* Console.error(
            `WARNING [${warning.code}] ${warning.method?.toUpperCase() ?? ""} ${warning.path ?? ""}: ${warning.message}`,
          )
        }

        yield* Console.log(`Generated ${definition.generatedFile}`)
        return [definition, spec, generatedClientMethods(fixed)] as const
      }),
    )

    yield* fs.makeDirectory("apps/cli/src/generated", { recursive: true })

    const cliFiles = generateCliFiles(
      documents.map(([definition, document, clientMethods]) => ({
        clientMethods,
        document,
        family: definition.id,
      })),
    )
    for (const file of cliFiles) {
      yield* fs.makeDirectory(file.path.slice(0, file.path.lastIndexOf("/")), {
        recursive: true,
      })
      yield* fs.writeFileString(file.path, file.content)
      yield* Console.log(`Generated ${file.path}`)
    }
  }),
)

Command.run(generate, { version: "0.1.0" }).pipe(
  Effect.provide([
    OpenApiGenerator.layerTransformerSchema,
    NodeHttpClient.layerUndici,
    NodeServices.layer,
  ]),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  NodeRuntime.runMain,
)
