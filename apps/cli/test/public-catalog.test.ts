import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Public from "@spiko/public-api-client"
import { Console, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { describe, expect, it } from "vitest"
import { makeCli } from "../src/cli.ts"
import { PublicOperations } from "../src/generated/public.ts"

const makeTestConsole = (stdout: Array<string>, stderr: Array<string>): Console.Console =>
  Object.assign(Object.create(console), {
    error: (...args: ReadonlyArray<unknown>) => stderr.push(args.join(" ")),
    log: (...args: ReadonlyArray<unknown>) => stdout.push(args.join(" ")),
  })

const run = <LayerError>(
  operationLayer: Layer.Layer<Public.PublicApi, LayerError>,
  args: ReadonlyArray<string>,
) => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  const cli = makeCli({ operationLayer, operations: PublicOperations, version: "test" })
  return Effect.runPromise(
    cli.run(args).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
      Effect.map((exitCode) => ({ exitCode, stderr, stdout })),
    ),
  )
}

const deadHttpClient = HttpClient.make(() => Effect.die("not executed"))
const PublicUnusedLayer = Layer.effect(
  Public.PublicApi,
  Effect.die("Operation client layer must not be acquired"),
)

const observedError = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    description: "observed",
    request: HttpClientRequest.get("https://public.example.test"),
  }),
})

const recordThenStop = (calls: Array<unknown>, call: unknown) =>
  Effect.sync(() => calls.push(call)).pipe(Effect.flatMap(() => Effect.fail(observedError)))

describe("generated Public Operation Catalog", () => {
  it("contains every unique Public Operation with self-contained schemas and routes", () => {
    expect(PublicOperations).toHaveLength(15)
    expect(new Set(PublicOperations.map(({ definition }) => definition.operationId)).size).toBe(15)
    expect(
      new Set(
        PublicOperations.map(
          ({ definition }) => `${definition.family}/${definition.resource}/${definition.action}`,
        ),
      ).size,
    ).toBe(15)

    for (const { definition } of PublicOperations) {
      expect(JSON.stringify(definition)).not.toContain("#/components/schemas/")
      expect(definition.responses.length).toBeGreaterThan(0)
    }
  })

  it("describes resolved parameter and response schemas without acquiring the client", async () => {
    const result = await run(PublicUnusedLayer, [
      "operations",
      "describe",
      "public",
      "Get Latest Exchange Rate",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toEqual([])
    expect(result.stdout).toHaveLength(1)
    const envelope = JSON.parse(result.stdout[0] ?? "")
    expect(envelope).toMatchObject({
      data: {
        action: "latest",
        family: "public",
        operationId: "Get Latest Exchange Rate",
      },
      ok: true,
      operation: "operations.describe",
    })
    expect(envelope.data.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          flag: "fund-id",
          required: true,
          schema: expect.objectContaining({ format: "uuid", type: "string" }),
        }),
        expect.objectContaining({
          flag: "quote-currency",
          required: true,
          schema: expect.objectContaining({
            $defs: expect.objectContaining({
              CurrencyCode: expect.objectContaining({ type: "string" }),
            }),
          }),
        }),
      ]),
    )
    expect(envelope.data.responses).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "200" })]),
    )
    expect(JSON.stringify(envelope)).not.toContain("#/components/schemas/")
  })

  it("binds representative path, query, optional, enum, and date-like inputs", async () => {
    const calls: Array<unknown> = []
    const layer = Layer.mock(Public.PublicApi, {
      baseUrl: "https://public.example.test/v0",
      httpClient: deadHttpClient,
      GetAllFundAssets: (options) => recordThenStop(calls, ["GetAllFundAssets", options]),
      GetLatestExchangeRate: (options) => recordThenStop(calls, ["GetLatestExchangeRate", options]),
      GetShareClassTotalsFromDay: (shareClassSymbol, options) =>
        recordThenStop(calls, ["GetShareClassTotalsFromDay", shareClassSymbol, options]),
    })

    expect(
      (
        await run(layer, [
          "call",
          "public",
          "share-classes",
          "totals-from-day",
          "--share-class-symbol",
          "EUTBL",
          "--start-day",
          "2025-01-01",
        ])
      ).exitCode,
    ).toBe(1)
    expect(
      (
        await run(layer, [
          "call",
          "public",
          "fund-assets",
          "list",
          "--fund-id",
          "00000000-0000-0000-0000-000000000000",
        ])
      ).exitCode,
    ).toBe(1)
    expect(
      (
        await run(layer, [
          "call",
          "public",
          "exchange-rates",
          "latest",
          "--fund-id",
          "00000000-0000-0000-0000-000000000000",
          "--quote-currency",
          "EUR",
          "--base-currency",
          "USD",
          "--fallback-to-any-other-fund",
          "true",
        ])
      ).exitCode,
    ).toBe(1)

    expect(calls).toEqual([
      ["GetShareClassTotalsFromDay", "EUTBL", { params: { startDay: "2025-01-01" } }],
      ["GetAllFundAssets", { params: { fundId: "00000000-0000-0000-0000-000000000000" } }],
      [
        "GetLatestExchangeRate",
        {
          params: {
            baseCurrency: "USD",
            fallbackToAnyOtherFund: "true",
            fundId: "00000000-0000-0000-0000-000000000000",
            quoteCurrency: "EUR",
          },
        },
      ],
    ])
  })

  it("rejects unsupported enum and malformed day values before acquiring the client", async () => {
    const calls: Array<unknown> = []
    const layer = Layer.effect(
      Public.PublicApi,
      Effect.sync(() => {
        calls.push("acquired")
        return Public.make(deadHttpClient, { baseUrl: "https://public.example.test/v0" })
      }),
    )

    const invalidEnum = await run(layer, [
      "call",
      "public",
      "exchange-rates",
      "latest",
      "--fund-id",
      "00000000-0000-0000-0000-000000000000",
      "--quote-currency",
      "CAD",
      "--base-currency",
      "USD",
    ])
    const invalidDay = await run(layer, [
      "call",
      "public",
      "share-classes",
      "totals-from-day",
      "--share-class-symbol",
      "EUTBL",
      "--start-day",
      "tomorrow",
    ])

    expect(invalidEnum.exitCode).toBe(2)
    expect(invalidDay.exitCode).toBe(2)
    expect(calls).toEqual([])
  })
})
