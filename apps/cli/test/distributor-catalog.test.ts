import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Distributor from "@spiko/distributor-api-client"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Console, Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { describe, expect, it } from "vitest"
import { type DefinedOperation, makeCli } from "../src/cli.ts"
import { DistributorOperations } from "../src/generated/distributor.ts"

const NoInvestorOperations: ReadonlyArray<DefinedOperation<"investor">> = []
const NoPublicOperations: ReadonlyArray<DefinedOperation<"public">> = []

const makeTestConsole = (stdout: Array<string>, stderr: Array<string>): Console.Console =>
  Object.assign(Object.create(console), {
    error: (...args: ReadonlyArray<unknown>) => stderr.push(args.join(" ")),
    log: (...args: ReadonlyArray<unknown>) => stdout.push(args.join(" ")),
  })

const run = <LayerError>(
  operationLayer: Layer.Layer<Distributor.DistributorApi, LayerError>,
  args: ReadonlyArray<string>,
) => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  const cli = makeCli({
    operationLayers: {
      distributor: operationLayer,
      investor: Layer.empty,
      public: Layer.empty,
    },
    operations: {
      distributor: DistributorOperations,
      investor: NoInvestorOperations,
      public: NoPublicOperations,
    },
    version: "test",
  })
  return Effect.runPromise(
    cli.run(args).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
      Effect.map((exitCode) => ({ exitCode, stderr, stdout })),
    ),
  )
}

const deadHttpClient = HttpClient.make(() => Effect.die("not executed"))
const observedError = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    description: "observed",
    request: HttpClientRequest.get("https://distributor.example.test"),
  }),
})

const writeTestFile = async (name: string, content: Uint8Array) => {
  const directory = await mkdtemp(join(tmpdir(), "spiko-cli-distributor-"))
  const path = join(directory, name)
  await writeFile(path, content)
  return { directory, path }
}

const investorId = "00000000-0000-4000-8000-000000000001"

describe("generated Distributor Operation Catalog", () => {
  it("contains every unique Distributor Operation and route", () => {
    expect(DistributorOperations).toHaveLength(65)
    expect(
      new Set(DistributorOperations.map(({ definition }) => definition.operationId)).size,
    ).toBe(65)
    expect(
      new Set(
        DistributorOperations.map(
          ({ definition }) => `${definition.family}/${definition.resource}/${definition.action}`,
        ),
      ).size,
    ).toBe(65)
  })

  it("uploads typed multipart values and binary file content exactly once", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 1, 2, 3])
    const testFile = await writeTestFile("identity.pdf", bytes)
    const calls: Array<unknown> = []
    let uploaded: File | undefined
    const layer = Layer.mock(Distributor.DistributorApi, {
      httpClient: deadHttpClient,
      investorDocumentsUploadInvestorDocument: (options) => {
        uploaded = options.payload.file[0]
        return Effect.sync(() =>
          calls.push({
            investorId: options.payload.investorId,
            type: options.payload.type,
          }),
        ).pipe(Effect.flatMap(() => Effect.fail(observedError)))
      },
    })

    try {
      const result = await run(layer, [
        "call",
        "distributor",
        "investor-documents",
        "upload",
        "--investor-id",
        investorId,
        "--type",
        "official-id",
        "--file",
        testFile.path,
        "--confirm",
      ])

      expect(result.exitCode).toBe(1)
      expect(calls).toEqual([{ investorId, type: "official-id" }])
      expect(uploaded).toBeInstanceOf(File)
      if (uploaded === undefined) {
        throw new Error("Expected the uploaded file")
      }
      expect(uploaded.name).toBe("identity.pdf")
      expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(bytes)
    } finally {
      await rm(testFile.directory, { force: true, recursive: true })
    }
  })

  it("rejects confirmation, extension, and file-read failures before client acquisition", async () => {
    const disallowed = await writeTestFile("identity.exe", new Uint8Array([1, 2, 3]))
    const acquisitions: Array<string> = []
    const layer = Layer.effect(
      Distributor.DistributorApi,
      Effect.sync(() => {
        acquisitions.push("acquired")
        return Distributor.make(deadHttpClient, {
          baseUrl: "https://distributor.example.test",
          clientId: Redacted.make("client-id"),
          clientSecret: Redacted.make("client-secret"),
        })
      }),
    )
    const baseArgs = [
      "call",
      "distributor",
      "investor-documents",
      "upload",
      "--investor-id",
      investorId,
      "--type",
      "official-id",
      "--file",
    ]

    try {
      const missingConfirmation = await run(layer, [...baseArgs, "/does/not/exist.pdf"])
      const disallowedExtension = await run(layer, [...baseArgs, disallowed.path, "--confirm"])
      const unreadableFile = await run(layer, [...baseArgs, "/does/not/exist.pdf", "--confirm"])

      expect(missingConfirmation.exitCode).toBe(2)
      expect(disallowedExtension.exitCode).toBe(2)
      expect(unreadableFile.exitCode).toBe(2)
      expect(acquisitions).toEqual([])
      for (const result of [missingConfirmation, disallowedExtension, unreadableFile]) {
        expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
          error: { code: "invalid-input" },
          ok: false,
          operation: "investorDocuments.uploadInvestorDocument",
        })
      }
    } finally {
      await rm(disallowed.directory, { force: true, recursive: true })
    }
  })

  it("documents multipart fields, extensions, cardinality, and confirmation without payload", async () => {
    const layer = Layer.effect(
      Distributor.DistributorApi,
      Effect.die("Operation client layer must not be acquired"),
    )
    const result = await run(layer, [
      "call",
      "distributor",
      "investor-documents",
      "upload",
      "--help",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(result.stdout[0]).toContain("--investor-id UUID")
    expect(result.stdout[0]).toContain("--type")
    expect(result.stdout[0]).toContain("official-id")
    expect(result.stdout[0]).toContain("--file FILE")
    expect(result.stdout[0]).toContain("pdf, jpg, png, doc, docx, xls, xlsx")
    expect(result.stdout[0]).toContain("Exactly one file")
    expect(result.stdout[0]).toContain("--confirm")
    expect(result.stdout[0]).not.toContain("--payload")
  })

  it("keeps Distributor JSON request bodies on payload files", async () => {
    const layer = Layer.effect(
      Distributor.DistributorApi,
      Effect.die("Operation client layer must not be acquired"),
    )
    const result = await run(layer, ["call", "distributor", "accounts", "create", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(result.stdout[0]).toContain("--payload FILE")
    expect(result.stdout[0]).toContain("Required application/json request body file")
    expect(result.stdout[0]).toContain("--confirm")
    expect(result.stdout[0]).not.toContain("--investor-id")
  })
})
