import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Public from "@spiko/public-api-client"
import { Console, Effect, Layer, Option, Queue, Terminal } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { Command } from "effect/unstable/cli"
import { type DefinedOperation, makeCli } from "../src/cli.ts"
import { GetFund, PublicOperations } from "../src/generated/public.ts"
import { key, makeTestConsole, noOperations, wizardEnvironment } from "./helpers.ts"

const fundId = "00000000-0000-0000-0000-000000000000"
const fund = {
  executionMethod: "knownNAVs" as const,
  id: fundId,
  launchDay: "2025-01-01",
  nonOperatingDays: [],
  slug: "EUTBL" as const,
  timezone: "Europe/Paris" as const,
}

const makePublicLayer = (execute: Parameters<typeof HttpClient.make>[0]) =>
  Layer.succeed(
    Public.PublicApi,
    Public.make(HttpClient.make(execute), {
      baseUrl: "https://public.example.test/v0",
    }),
  )

const jsonResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  body: unknown,
  status = 200,
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    }),
  )

const PublicUnusedLayer = Layer.effect(
  Public.PublicApi,
  Effect.die("Operation client layer must not be acquired"),
)

const makeTestCli = <LayerError, LayerRequirements>(
  operationLayer: Layer.Layer<Public.PublicApi, LayerError, LayerRequirements>,
) =>
  makeCli({
    operationLayers: {
      distributor: Layer.empty,
      investor: Layer.empty,
      public: operationLayer,
    },
    operations: {
      distributor: noOperations(),
      investor: noOperations(),
      public: PublicOperations,
    },
    version: "test",
  })

const UnusedTerminal = Terminal.make({
  columns: Effect.succeed(80),
  display: () => Effect.void,
  readInput: Effect.die("unused"),
  readLine: Effect.die("unused"),
  rows: Effect.succeed(24),
})

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// The generated invocation closure's remote requirement is inferred from the real
// invoke closure, so this proves the family client tag stays a compile-time
// requirement until makeCli provides its layer.
type OperationRequirements<Operation> =
  Operation extends DefinedOperation<any, infer Requirements, any, any> ? Requirements : never

type _OperationRequirementsRemainVisible = Expect<
  Equal<OperationRequirements<typeof GetFund>, Public.PublicApi>
>

const TypecheckCli = makeTestCli(PublicUnusedLayer)
type _CliRequirementsRemainVisible = Expect<
  Equal<Command.Services<typeof TypecheckCli.rootCommand>, never>
>
describe("spiko command interface", () => {
  it("invokes a generated Public Operation through its client tag", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const calls: Array<string> = []
    const publicLayer = makePublicLayer((request, url) =>
      Effect.sync(() => {
        calls.push(url.pathname)
        return jsonResponse(request, fund)
      }),
    )
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--fund-id", fundId])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([`/v0/funds/${fundId}`])
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0] ?? "")).toEqual({
      data: fund,
      ok: true,
      operation: "Get Fund",
    })
  })

  it("returns a JSON failure envelope for remote errors", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const publicLayer = makePublicLayer((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 503 }))),
    )
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--fund-id", fundId])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(1)
    expect(stdout).toEqual([])
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      error: { code: "remote-failure", details: [] },
      ok: false,
      operation: "Get Fund",
    })
  })

  it("returns a JSON failure envelope for internal defects", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const publicLayer = makePublicLayer(() => Effect.die("simulated defect"))
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--fund-id", fundId])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(1)
    expect(stdout).toEqual([])
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      error: { code: "internal-failure", details: [], message: "Internal CLI failure." },
      ok: false,
      operation: "Get Fund",
    })
  })

  it("rejects invalid input before client invocation", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const calls: Array<string> = []
    const publicLayer = makePublicLayer((request, url) =>
      Effect.sync(() => {
        calls.push(url.pathname)
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 500 }))
      }),
    )
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--fund-id", "not-a-uuid"])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(2)
    expect(calls).toEqual([])
    expect(stdout).toEqual([])
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      error: { code: "invalid-input", details: [] },
      ok: false,
      operation: "Get Fund",
    })
  })

  it("describes one generated Operation with its input schema", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["operations", "describe", "public", "Get Fund"])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
      data: {
        action: "get",
        family: "public",
        method: "GET",
        operationId: "Get Fund",
        parameters: [
          {
            flag: "fund-id",
            in: "path",
            name: "fundId",
            required: true,
            schema: { format: "uuid", type: "string" },
          },
        ],
        path: "/funds/{fundId}",
        requestBody: null,
        resource: "funds",
        safety: "read",
      },
      ok: true,
      operation: "operations.describe",
    })
  })

  it("rejects the wizard without an interactive terminal", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["--wizard"])
        .pipe(
          Effect.provide(wizardEnvironment(UnusedTerminal, false)),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr).toHaveLength(1)
    expect(JSON.parse(stderr[0] ?? "")).toMatchObject({
      error: { code: "wizard-requires-terminal", details: [] },
      ok: false,
      operation: "cli",
    })
  })

  it("runs the generated Operation through the interactive wizard", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const terminalOutput: Array<string> = []
    const calls: Array<string> = []
    const events = [
      key("down"),
      key("enter"),
      key("enter"),
      key("enter"),
      key("enter"),
      ...Array.from(fundId, (character) => key(character, Option.some(character))),
      key("enter"),
      key("enter"),
    ]
    const publicLayer = makePublicLayer((request, url) =>
      Effect.sync(() => {
        calls.push(url.pathname)
        return jsonResponse(request, fund)
      }),
    )
    const cli = makeTestCli(publicLayer)

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

        return yield* cli
          .run(["--wizard"])
          .pipe(
            Effect.provide(wizardEnvironment(terminal)),
            Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
          )
      }),
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([`/v0/funds/${fundId}`])
    expect(stderr).toEqual([])
    expect(terminalOutput.length).toBeGreaterThan(0)
    expect(stdout.some((message) => message.includes('"operation": "Get Fund"'))).toBe(true)
  })

  it("returns exit 130 when the interactive wizard is cancelled", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      Effect.gen(function* () {
        const input = yield* Queue.unbounded<Terminal.UserInput>()
        yield* Queue.shutdown(input)
        const terminal = Terminal.make({
          columns: Effect.succeed(80),
          display: () => Effect.void,
          readInput: Effect.succeed(input),
          readLine: Effect.die("unused"),
          rows: Effect.succeed(24),
        })

        return yield* cli
          .run(["--wizard"])
          .pipe(
            Effect.provide(wizardEnvironment(terminal)),
            Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
          )
      }),
    )

    expect(exitCode).toBe(130)
    expect(stdout.some((message) => message.includes('"ok"'))).toBe(false)
    expect(stderr).toEqual([])
  })

  it("documents generated input in command help", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--help"])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    expect(stdout[0]).toContain("GET /funds/{fundId} — Get Fund")
    expect(stdout[0]).toContain("--fund-id UUID")
    expect(stdout[0]).toContain("Required path parameter: fundId — a Universally Unique Identifier")
  })

  it("lists generated Public Operations as JSON", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["operations", "list", "public"])
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    const envelope = JSON.parse(stdout[0] ?? "")
    expect(envelope).toMatchObject({ ok: true, operation: "operations.list" })
    expect(envelope.data).toHaveLength(15)
    expect(envelope.data).toContainEqual({
      action: "get",
      command: "spiko call public funds get",
      description: "Get Fund",
      method: "GET",
      operationId: "Get Fund",
      path: "/funds/{fundId}",
      resource: "funds",
    })
  })
})
