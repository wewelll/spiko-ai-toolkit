export type GeneratedClientFamily = "distributor" | "investor" | "public"

const replaceExactlyOnce = (source: string, expected: string, replacement: string): string => {
  const first = source.indexOf(expected)
  const last = source.lastIndexOf(expected)
  if (first === -1 || first !== last) {
    throw new Error(
      `Expected one generated client fragment but found ${first === -1 ? 0 : "multiple"}: ${expected}`,
    )
  }
  return source.replace(expected, replacement)
}

export const fixGeneratedClient = (family: GeneratedClientFamily, generated: string): string => {
  if (family !== "distributor") {
    return generated
  }

  return replaceExactlyOnce(
    replaceExactlyOnce(
      generated,
      'export type PersistedFile = string\nexport const PersistedFile = Schema.String.annotate({ "format": "binary", "identifier": "PersistedFile" })',
      'export type PersistedFile = globalThis.File\nexport const PersistedFile = Schema.instanceOf(globalThis.File).annotate({ "format": "binary", "identifier": "PersistedFile" })',
    ),
    "HttpClientRequest.bodyFormData(options.payload as any)",
    "HttpClientRequest.bodyFormDataRecord(options.payload)",
  )
}
