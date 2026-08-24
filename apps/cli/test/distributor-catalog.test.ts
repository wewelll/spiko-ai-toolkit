import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Distributor from "@spiko/distributor-api-client"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Console, Effect, Layer, Option, Queue, Redacted, Terminal } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { makeCli } from "../src/cli.ts"
import { DistributorOperations } from "../src/generated/distributor.ts"
import {
  deadHttpClient,
  key,
  makeTestConsole,
  noOperations,
  observedError,
  wizardEnvironment,
} from "./helpers.ts"

const makeTestCli = <LayerError>(
  operationLayer: Layer.Layer<Distributor.DistributorApi, LayerError>,
) =>
  makeCli({
    operationLayers: {
      distributor: operationLayer,
      investor: Layer.empty,
      public: Layer.empty,
    },
    operations: {
      distributor: DistributorOperations,
      investor: noOperations(),
      public: noOperations(),
    },
    version: "test",
  })

const run = <LayerError>(
  operationLayer: Layer.Layer<Distributor.DistributorApi, LayerError>,
  args: ReadonlyArray<string>,
) => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  return Effect.runPromise(
    makeTestCli(operationLayer)
      .run(args)
      .pipe(
        Effect.provide(NodeServices.layer),
        Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        Effect.map((exitCode) => ({ exitCode, stderr, stdout })),
      ),
  )
}

const writeTestFile = async (name: string, content: Uint8Array) => {
  const directory = await mkdtemp(join(tmpdir(), "spiko-cli-distributor-"))
  const path = join(directory, name)
  await writeFile(path, content)
  return { directory, path }
}

const investorId = "00000000-0000-4000-8000-000000000001"
const shareClassId = "00000000-0000-4000-8000-000000000002"

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

  it("renders binary account statements as base64 JSON data", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(bytes, { status: 200 }))),
    )
    const layer = Layer.succeed(
      Distributor.DistributorApi,
      Distributor.make(httpClient, {
        baseUrl: "https://distributor.example.test",
        clientId: Redacted.make("client-id"),
        clientSecret: Redacted.make("client-secret"),
      }),
    )

    const result = await run(layer, [
      "call",
      "distributor",
      "accounting-positions",
      "account-statement",
      "--investor-id",
      investorId,
      "--share-class-id",
      shareClassId,
      "--from",
      "2025-01-01",
      "--to",
      "2025-01-31",
      "--locale",
      "en",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(JSON.parse(result.stdout[0] ?? "")).toEqual({
      data: { encoding: "base64", value: "JVBERg==" },
      ok: true,
      operation: "accountingPositions.downloadAccountStatement",
    })
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

  it("prompts for multipart fields and still enforces confirmation in the wizard", async () => {
    const resources = Array.from(
      new Set(DistributorOperations.map(({ definition }) => definition.resource)),
    )
    const resourceIndex = resources.indexOf("investor-documents")
    const actions = DistributorOperations.filter(
      ({ definition }) => definition.resource === "investor-documents",
    ).map(({ definition }) => definition.action)
    const actionIndex = actions.indexOf("upload")
    if (resourceIndex < 0 || actionIndex < 0) {
      throw new Error("Missing generated multipart wizard route")
    }
    const file = "/unused/identity.pdf"
    const events = [
      key("down"),
      key("enter"),
      key("enter"),
      ...Array.from({ length: resourceIndex }, () => key("down")),
      key("enter"),
      ...Array.from({ length: actionIndex }, () => key("down")),
      key("enter"),
      ...Array.from(investorId, (character) => key(character, Option.some(character))),
      key("enter"),
      ...Array.from({ length: 4 }, () => key("down")),
      key("enter"),
      ...Array.from(file, (character) => key(character, Option.some(character))),
      key("enter"),
      key("enter"),
      key("enter"),
    ]
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const terminalOutput: Array<string> = []
    const layer = Layer.effect(
      Distributor.DistributorApi,
      Effect.die("Operation client layer must not be acquired"),
    )

    const exitCode = await Effect.runPromise(
      Effect.gen(function* () {
        const input = yield* Queue.unbounded<Terminal.UserInput>()
        yield* Queue.offerAll(input, events)
        const terminal = Terminal.make({
          columns: Effect.succeed(80),
          display: (text) => Effect.sync(() => terminalOutput.push(text)),
          readInput: Effect.succeed(input),
          readLine: Effect.die("unused"),
          rows: Effect.succeed(24),
        })
        return yield* makeTestCli(layer)
          .run(["--wizard"])
          .pipe(
            Effect.provide(wizardEnvironment(terminal)),
            Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
          )
      }),
    )

    expect(exitCode).toBe(2)
    expect(terminalOutput.length).toBeGreaterThan(0)
    expect(stdout.some((line) => line.includes("--file /unused/identity.pdf"))).toBe(true)
    expect(stdout.some((line) => line.includes("--confirm false"))).toBe(true)
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      error: { code: "invalid-input" },
      operation: "investorDocuments.uploadInvestorDocument",
    })
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
