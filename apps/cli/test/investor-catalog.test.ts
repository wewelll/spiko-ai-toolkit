import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Investor from "@spiko/investor-api-client"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Console, Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { type DefinedOperation, makeCli } from "../src/cli.ts"
import { InvestorOperations } from "../src/generated/investor.ts"

const NoDistributorOperations: ReadonlyArray<DefinedOperation<"distributor">> = []
const NoPublicOperations: ReadonlyArray<DefinedOperation<"public">> = []

const makeTestConsole = (stdout: Array<string>, stderr: Array<string>): Console.Console =>
  Object.assign(Object.create(console), {
    error: (...args: ReadonlyArray<unknown>) => stderr.push(args.join(" ")),
    log: (...args: ReadonlyArray<unknown>) => stdout.push(args.join(" ")),
  })

const run = <LayerError>(
  operationLayer: Layer.Layer<Investor.InvestorApi, LayerError>,
  args: ReadonlyArray<string>,
) => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  const cli = makeCli({
    operationLayers: {
      distributor: Layer.empty,
      investor: operationLayer,
      public: Layer.empty,
    },
    operations: {
      distributor: NoDistributorOperations,
      investor: InvestorOperations,
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
    request: HttpClientRequest.get("https://investor.example.test"),
  }),
})
const recordThenStop = (calls: Array<unknown>, call: unknown) =>
  Effect.sync(() => calls.push(call)).pipe(Effect.flatMap(() => Effect.fail(observedError)))

const writePayload = async (content: string) => {
  const directory = await mkdtemp(join(tmpdir(), "spiko-cli-investor-"))
  const path = join(directory, "payload.json")
  await writeFile(path, content)
  return { directory, path }
}

const investorId = "00000000-0000-4000-8000-000000000001"
const shareClassId = "00000000-0000-4000-8000-000000000002"

describe("generated Investor Operation Catalog", () => {
  it("contains every unique Investor Operation and route", () => {
    expect(InvestorOperations).toHaveLength(35)
    expect(new Set(InvestorOperations.map(({ definition }) => definition.operationId)).size).toBe(
      35,
    )
    expect(
      new Set(
        InvestorOperations.map(
          ({ definition }) => `${definition.family}/${definition.resource}/${definition.action}`,
        ),
      ).size,
    ).toBe(35)
    for (const { definition } of InvestorOperations) {
      expect(JSON.stringify(definition)).not.toContain("#/components/schemas/")
    }
  })

  it("lists every Investor Operation without acquiring the client", async () => {
    const layer = Layer.effect(
      Investor.InvestorApi,
      Effect.die("Operation client layer must not be acquired"),
    )
    const result = await run(layer, ["operations", "list", "investor"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(JSON.parse(result.stdout[0] ?? "")).toMatchObject({
      data: expect.any(Array),
      ok: true,
      operation: "operations.list",
    })
    expect(JSON.parse(result.stdout[0] ?? "").data).toHaveLength(35)
  })

  it("validates and invokes a confirmed JSON mutation with the encoded payload", async () => {
    const payload = { investorId, shareClassId, type: "internal" as const }
    const file = await writePayload(JSON.stringify(payload))
    const calls: Array<unknown> = []
    const layer = Layer.mock(Investor.InvestorApi, {
      httpClient: deadHttpClient,
      accountsCreateAccount: (options) => recordThenStop(calls, ["accountsCreateAccount", options]),
    })

    try {
      const result = await run(layer, [
        "call",
        "investor",
        "accounts",
        "create",
        "--payload",
        file.path,
        "--confirm",
      ])

      expect(result.exitCode).toBe(1)
      expect(calls).toEqual([["accountsCreateAccount", { payload }]])
    } finally {
      await rm(file.directory, { force: true, recursive: true })
    }
  })

  it("requires confirmation before file access or client acquisition", async () => {
    const acquisitions: Array<string> = []
    const layer = Layer.effect(
      Investor.InvestorApi,
      Effect.sync(() => {
        acquisitions.push("acquired")
        return Investor.make(deadHttpClient, {
          auth: { accessToken: Redacted.make("test"), type: "bearer" },
          baseUrl: "https://investor.example.test",
        })
      }),
    )

    const result = await run(layer, [
      "call",
      "investor",
      "accounts",
      "create",
      "--payload",
      "/does/not/exist.json",
    ])

    expect(result.exitCode).toBe(2)
    expect(acquisitions).toEqual([])
    expect(JSON.parse(result.stderr[0] ?? "")).toMatchObject({
      error: { code: "invalid-input" },
      ok: false,
      operation: "accounts.createAccount",
    })
  })

  it("rejects invalid JSON and schema-invalid payloads before client acquisition", async () => {
    const invalidJson = await writePayload("{")
    const invalidSchema = await writePayload("{}")
    const acquisitions: Array<string> = []
    const layer = Layer.effect(
      Investor.InvestorApi,
      Effect.sync(() => {
        acquisitions.push("acquired")
        return Investor.make(deadHttpClient, {
          auth: { accessToken: Redacted.make("test"), type: "bearer" },
          baseUrl: "https://investor.example.test",
        })
      }),
    )

    try {
      const invalidJsonResult = await run(layer, [
        "call",
        "investor",
        "accounts",
        "create",
        "--payload",
        invalidJson.path,
        "--confirm",
      ])
      const invalidSchemaResult = await run(layer, [
        "call",
        "investor",
        "accounts",
        "create",
        "--payload",
        invalidSchema.path,
        "--confirm",
      ])

      expect(invalidJsonResult.exitCode).toBe(2)
      expect(invalidSchemaResult.exitCode).toBe(2)
      expect(JSON.parse(invalidJsonResult.stderr[0] ?? "")).toMatchObject({
        error: { code: "invalid-input", message: expect.stringContaining("valid JSON") },
        operation: "accounts.createAccount",
      })
      expect(JSON.parse(invalidSchemaResult.stderr[0] ?? "")).toMatchObject({
        error: {
          code: "invalid-input",
          message: expect.stringContaining("OpenAPI request schema"),
        },
        operation: "accounts.createAccount",
      })
      expect(acquisitions).toEqual([])
    } finally {
      await Promise.all([
        rm(invalidJson.directory, { force: true, recursive: true }),
        rm(invalidSchema.directory, { force: true, recursive: true }),
      ])
    }
  })

  it("binds location-qualified collisions and repeated arrays in source order", async () => {
    const calls: Array<unknown> = []
    const layer = Layer.mock(Investor.InvestorApi, {
      httpClient: deadHttpClient,
      bankAccountsGetBankAccountById: (pathBankAccountId, options) =>
        recordThenStop(calls, ["bankAccountsGetBankAccountById", pathBankAccountId, options]),
      transferOrdersGetTransferOrders: (options) =>
        recordThenStop(calls, ["transferOrdersGetTransferOrders", options]),
    })
    const pathBankAccountId = "00000000-0000-4000-8000-000000000003"
    const queryBankAccountId = "00000000-0000-4000-8000-000000000004"

    const collisionResult = await run(layer, [
      "call",
      "investor",
      "bank-accounts",
      "get",
      "--path-bank-account-id",
      pathBankAccountId,
      "--query-bank-account-id",
      queryBankAccountId,
    ])
    expect(collisionResult.exitCode).toBe(1)
    expect(
      (
        await run(layer, [
          "call",
          "investor",
          "transfer-orders",
          "list",
          "--investor-id",
          investorId,
          "--status",
          "pending",
          "--status",
          "executed",
        ])
      ).exitCode,
    ).toBe(1)

    expect(calls).toEqual([
      [
        "bankAccountsGetBankAccountById",
        pathBankAccountId,
        { params: { bankAccountId: queryBankAccountId } },
      ],
      [
        "transferOrdersGetTransferOrders",
        { params: { investorId, status: ["pending", "executed"] } },
      ],
    ])
  })

  it("renders binary account statements as base64 JSON data", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const httpClient = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(bytes, { status: 200 }))),
    )
    const layer = Layer.succeed(
      Investor.InvestorApi,
      Investor.make(httpClient, {
        auth: { accessToken: Redacted.make("test"), type: "bearer" },
        baseUrl: "https://investor.example.test",
      }),
    )

    const result = await run(layer, [
      "call",
      "investor",
      "accounting-positions",
      "account-statement",
      "--investor-id",
      investorId,
      "--share-class-symbol",
      "EUTBL",
      "--from",
      "2025-01-01",
      "--to",
      "2025-01-31",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(JSON.parse(result.stdout[0] ?? "")).toEqual({
      data: { encoding: "base64", value: "JVBERg==" },
      ok: true,
      operation: "accountingPositions.downloadAccountStatement",
    })
  })

  it("documents JSON payload and independent mutation confirmation flags", async () => {
    const layer = Layer.effect(
      Investor.InvestorApi,
      Effect.die("Operation client layer must not be acquired"),
    )
    const result = await run(layer, ["call", "investor", "accounts", "create", "--help"])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(result.stdout[0]).toContain("POST /accounts/")
    expect(result.stdout[0]).toContain("--payload FILE")
    expect(result.stdout[0]).toContain("Required application/json request body file")
    expect(result.stdout[0]).toContain("--confirm")
  })
})
