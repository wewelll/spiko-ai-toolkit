export type GeneratedClientFamily = "distributor" | "investor" | "public"

// Operation IDs (camelized client method names) whose binary success responses
// are manually corrected below. The OpenAPI documents are the source of truth:
// generate-clients.ts fails when this manifest and the committed specs drift.
export const correctedBinaryResponseOperations: Readonly<
  Record<GeneratedClientFamily, ReadonlySet<string>>
> = {
  distributor: new Set(["accountingPositionsDownloadAccountStatement"]),
  investor: new Set(["accountingPositionsDownloadAccountStatement"]),
  public: new Set(),
}

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

// The Spiko account-statement Operations declare `application/pdf` success
// content, which the generator cannot decode: it emits no "2xx" matcher arm and
// types the success value as void, so a successful download would fail as an
// unexpected status. Patch in a raw-bytes matcher arm and widen the declared
// success type to Uint8Array for every family exposing that Operation.
const accountStatementPdfCorrections: ReadonlyArray<Correction> = [
  {
    expected:
      'withResponse(options.config)(HttpClientResponse.matchStatus({\n      "400": decodeError("AccountingPositionsDownloadAccountStatement400", AccountingPositionsDownloadAccountStatement400),',
    replacement:
      'withResponse(options.config)(HttpClientResponse.matchStatus({\n      "2xx": (response) => Effect.map(response.arrayBuffer, (buffer) => new Uint8Array(buffer)),\n      "400": decodeError("AccountingPositionsDownloadAccountStatement400", AccountingPositionsDownloadAccountStatement400),',
  },
  {
    expected:
      'readonly "accountingPositionsDownloadAccountStatement": <Config extends OperationConfig>(options: { readonly params: typeof AccountingPositionsDownloadAccountStatementParams.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<void, Config>,',
    replacement:
      'readonly "accountingPositionsDownloadAccountStatement": <Config extends OperationConfig>(options: { readonly params: typeof AccountingPositionsDownloadAccountStatementParams.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<Uint8Array, Config>,',
  },
]

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
    ...accountStatementPdfCorrections,
  ])

const fixInvestor = (generated: string): string =>
  applyCorrections("Investor generated client", generated, accountStatementPdfCorrections)

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
