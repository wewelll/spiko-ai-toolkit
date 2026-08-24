import { camelize } from "@effect/openapi-generator/Utils"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { describe, expect, it } from "vitest"
import { generateCliFiles, type CliSourceDocument } from "../../../tools/generate-cli.ts"

interface SyntheticOverride {
  readonly index: number
  readonly operationId?: string
  readonly parameters?: ReadonlyArray<unknown>
}

// Synthetic Operation Documents exercise the real generation entry point; every
// Operation gets a unique path so route policy stays collision-free.
const syntheticDocument = (
  count: number,
  overrides: ReadonlyArray<SyntheticOverride> = [],
): OpenAPISpec => {
  const paths: Record<string, unknown> = {}
  for (let index = 0; index < count; index++) {
    const override = overrides.find((candidate) => candidate.index === index)
    paths[`/v0/test/action-${index}`] = {
      get: {
        operationId: override?.operationId ?? `Test Op ${index}`,
        parameters: [...(override?.parameters ?? [])],
        responses: {},
        tags: ["Test"],
      },
    }
  }
  return { paths } as unknown as OpenAPISpec
}

const syntheticDocuments = (
  publicOverrides: ReadonlyArray<SyntheticOverride>,
): ReadonlyArray<CliSourceDocument> => {
  const publicOperationIds = Array.from(
    { length: 15 },
    (_, index) =>
      publicOverrides.find((candidate) => candidate.index === index)?.operationId ??
      `Test Op ${index}`,
  )
  return [
    {
      clientMethods: new Set(publicOperationIds.map(camelize)),
      document: syntheticDocument(15, publicOverrides),
      family: "public",
    },
    {
      clientMethods: new Set(
        Array.from({ length: 35 }, (_, index) => camelize(`Test Op ${index}`)),
      ),
      document: syntheticDocument(35),
      family: "investor",
    },
    {
      clientMethods: new Set(
        Array.from({ length: 65 }, (_, index) => camelize(`Test Op ${index}`)),
      ),
      document: syntheticDocument(65),
      family: "distributor",
    },
  ]
}

describe("generated CLI source invariants", () => {
  it("renders one export per synthetic Operation", () => {
    const files = generateCliFiles(syntheticDocuments([]))
    expect(files.map(({ path }) => path)).toEqual([
      "apps/cli/src/generated/public.ts",
      "apps/cli/src/generated/investor.ts",
      "apps/cli/src/generated/distributor.ts",
    ])
    expect(files[0]?.content.match(/^export const /gm)).toHaveLength(16)
    expect(files[0]?.content.match(/defineOperation\(/gm)).toHaveLength(15)
    expect(files[0]?.content).toContain("export const PublicOperations = [")
  })

  it("fails generation when an operationId is not a valid TypeScript identifier", () => {
    expect(() =>
      generateCliFiles(syntheticDocuments([{ index: 3, operationId: "123" }])),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid generated identifier(s): 123 GET /v0/test/action-3 -> ""]`,
    )
  })

  it("fails generation when an operationId collides with a reserved word", () => {
    expect(() =>
      generateCliFiles(syntheticDocuments([{ index: 3, operationId: "default" }])),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid generated identifier(s): default GET /v0/test/action-3 -> "default"]`,
    )
  })

  it("identifies the Operation when an unsupported parameter shape fails generation", () => {
    expect(() =>
      generateCliFiles(
        syntheticDocuments([
          {
            index: 7,
            parameters: [
              {
                description: "a weird parameter",
                in: "query",
                name: "weird",
                required: false,
                schema: { format: "int64", type: "string" },
              },
            ],
          },
        ]),
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Test Op 7 GET /v0/test/action-7: weird: unsupported parameter format "int64"]`,
    )
  })
})
