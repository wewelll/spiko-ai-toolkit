import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { describe, expect, it } from "vitest"
import { findUnsupportedSuccessMediaTypes } from "../../../tools/validate-openapi.ts"

const documentWithSuccessMediaType = (mediaType: string): OpenAPISpec => ({
  openapi: "3.1.0",
  info: { title: "Test", version: "1.0.0" },
  paths: {
    "/test": {
      get: {
        operationId: "getTest",
        parameters: [],
        responses: {
          200: {
            description: "Success",
            content: { [mediaType]: { schema: { type: "string" } } },
          },
        },
        tags: ["Test"],
        security: [],
      },
    },
  },
  components: { schemas: {}, securitySchemes: {} },
  security: [],
  tags: [],
})

describe("OpenAPI generation validation", () => {
  it("accepts media types supported by the RC generator", () => {
    expect(
      findUnsupportedSuccessMediaTypes(documentWithSuccessMediaType("application/pdf")),
    ).toEqual([])
    expect(
      findUnsupportedSuccessMediaTypes(documentWithSuccessMediaType("application/vnd.test+json")),
    ).toEqual([])
  })

  it("reports unsupported success media types with operation context", () => {
    expect(
      findUnsupportedSuccessMediaTypes(documentWithSuccessMediaType("application/xml")),
    ).toEqual([
      {
        mediaType: "application/xml",
        operationId: "getTest",
        path: "/test",
        status: "200",
      },
    ])
    expect(
      findUnsupportedSuccessMediaTypes(documentWithSuccessMediaType("text/plain")),
    ).toHaveLength(1)
  })
})
