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

const fixDistributor = (generated: string): string =>
  replaceExactlyOnce(
    replaceExactlyOnce(
      generated,
      'export type PersistedFile = string\nexport const PersistedFile = Schema.String.annotate({ "format": "binary", "identifier": "PersistedFile" })',
      'export type PersistedFile = globalThis.File\nexport const PersistedFile = Schema.instanceOf(globalThis.File).annotate({ "format": "binary", "identifier": "PersistedFile" })',
    ),
    "HttpClientRequest.bodyFormData(options.payload as any)",
    "HttpClientRequest.bodyFormDataRecord(options.payload)",
  )

const fixInvestor = (generated: string): string =>
  replaceExactlyOnce(
    replaceExactlyOnce(
      generated,
      'withResponse(options.config)(HttpClientResponse.matchStatus({\n      "400": decodeError("AccountingPositionsDownloadAccountStatement400", AccountingPositionsDownloadAccountStatement400),',
      'withResponse(options.config)(HttpClientResponse.matchStatus({\n      "2xx": (response) => Effect.map(response.arrayBuffer, (buffer) => new Uint8Array(buffer)),\n      "400": decodeError("AccountingPositionsDownloadAccountStatement400", AccountingPositionsDownloadAccountStatement400),',
    ),
    'readonly "accountingPositionsDownloadAccountStatement": <Config extends OperationConfig>(options: { readonly params: typeof AccountingPositionsDownloadAccountStatementParams.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>,',
    'readonly "accountingPositionsDownloadAccountStatement": <Config extends OperationConfig>(options: { readonly params: typeof AccountingPositionsDownloadAccountStatementParams.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<Uint8Array, Config>,',
  )

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
