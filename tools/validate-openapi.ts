import { Predicate } from "effect"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"

const methods = ["delete", "get", "head", "options", "patch", "post", "put", "trace"] as const

const normalizeMediaType = (mediaType: string): string =>
  mediaType.toLowerCase().split(";", 1)[0]?.trim() ?? ""

const isJsonMediaType = (mediaType: string): boolean =>
  mediaType === "application/json" ||
  (mediaType.startsWith("application/") && mediaType.endsWith("+json"))

const binaryMediaTypes = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-zip-compressed",
])

const isBinaryMediaType = (mediaType: string): boolean =>
  binaryMediaTypes.has(mediaType) ||
  ["image/", "audio/", "video/", "font/"].some((prefix) => mediaType.startsWith(prefix)) ||
  (mediaType.startsWith("application/") &&
    (mediaType.includes("binary") ||
      mediaType.endsWith("+octet-stream") ||
      mediaType.endsWith("+zip") ||
      mediaType.endsWith("+gzip")))

const isBinarySchema = (schema: unknown): boolean =>
  Predicate.isObject(schema) &&
  ((typeof schema.format === "string" && schema.format.toLowerCase() === "binary") ||
    (typeof schema.contentEncoding === "string" &&
      schema.contentEncoding.toLowerCase() === "binary"))

const isSupportedMediaType = (mediaType: string, schema: unknown): boolean => {
  const normalized = normalizeMediaType(mediaType)
  return (
    isJsonMediaType(normalized) ||
    (normalized === "text/event-stream" && schema !== undefined) ||
    isBinaryMediaType(normalized) ||
    isBinarySchema(schema)
  )
}

export interface UnsupportedSuccessMediaType {
  readonly operationId: string
  readonly path: string
  readonly status: string
  readonly mediaType: string
}

export const findUnsupportedSuccessMediaTypes = (
  document: OpenAPISpec,
): ReadonlyArray<UnsupportedSuccessMediaType> => {
  const unsupported: Array<UnsupportedSuccessMediaType> = []

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method]
      if (operation === undefined) {
        continue
      }

      for (const [status, response] of Object.entries(operation.responses)) {
        if (!status.startsWith("2") || response.content === undefined) {
          continue
        }

        for (const [mediaType, media] of Object.entries(response.content)) {
          if (!isSupportedMediaType(mediaType, media.schema)) {
            unsupported.push({ operationId: operation.operationId, path, status, mediaType })
          }
        }
      }
    }
  }

  return unsupported
}
