export type GeneratedClientFamily = "distributor" | "investor" | "public"

const replaceExactlyOnce = (
  label: string,
  source: string,
  expected: string,
  replacement: string,
): string => {
  const first = source.indexOf(expected)
  const last = source.lastIndexOf(expected)
  if (first === -1 || first !== last) {
    throw new Error(
      `${label}: expected one generated client fragment but found ${first === -1 ? 0 : "multiple"}: ${expected}`,
    )
  }
  return source.replace(expected, replacement)
}

interface Correction {
  readonly expected: string
  readonly replacement: string
}

const binaryRequestTransformCorrection: Correction = {
  expected:
    "const binaryRequest = (request: HttpClientRequest.HttpClientRequest): Stream.Stream<Uint8Array, HttpClientError.HttpClientError> =>\n    HttpClient.filterStatusOk(httpClient).execute(request).pipe(\n      Effect.map((response) => response.stream),\n      Stream.unwrap\n    )",
  replacement:
    "const binaryRequest = (request: HttpClientRequest.HttpClientRequest): Stream.Stream<Uint8Array, HttpClientError.HttpClientError> =>\n    (options?.transformClient\n      ? Effect.flatMap(options.transformClient(httpClient), (client) =>\n          HttpClient.filterStatusOk(client).execute(request),\n        )\n      : HttpClient.filterStatusOk(httpClient).execute(request)\n    ).pipe(\n      Effect.map((response) => response.stream),\n      Stream.unwrap,\n    )",
}

const applyCorrections = (
  label: string,
  generated: string,
  corrections: ReadonlyArray<Correction>,
): string =>
  corrections.reduce(
    (source, correction) =>
      replaceExactlyOnce(label, source, correction.expected, correction.replacement),
    generated,
  )

const fixDistributor = (generated: string): string =>
  applyCorrections("Distributor generated client", generated, [
    // The Distributor spec models uploaded files as {"type": "string", "format":
    // "binary"}, which the generator renders as Schema.String, so multipart
    // upload could only carry strings instead of file bytes. Retype
    // PersistedFile as an identity schema over globalThis.File.
    {
      expected:
        'export type PersistedFile = string\nexport const PersistedFile = Schema.String.annotate({ "format": "binary", "identifier": "PersistedFile" })',
      replacement:
        'export type PersistedFile = globalThis.File\nexport const PersistedFile = Schema.instanceOf(globalThis.File).annotate({ "format": "binary", "identifier": "PersistedFile" })',
    },
    // The generator emits HttpClientRequest.bodyFormData(options.payload as
    // any), but bodyFormData requires a FormData instance, which the generated
    // payload never is; bodyFormDataRecord accepts the flat record of scalars
    // and Files that the client actually builds and removes the unsafe cast.
    {
      expected: "HttpClientRequest.bodyFormData(options.payload as any)",
      replacement: "HttpClientRequest.bodyFormDataRecord(options.payload)",
    },
    binaryRequestTransformCorrection,
  ])

const fixInvestor = (generated: string): string =>
  applyCorrections("Investor generated client", generated, [binaryRequestTransformCorrection])

export const fixGeneratedClient = (family: GeneratedClientFamily, generated: string): string => {
  switch (family) {
    case "distributor":
      return fixDistributor(generated)
    case "investor":
      return fixInvestor(generated)
    case "public":
      return generated
  }
}
