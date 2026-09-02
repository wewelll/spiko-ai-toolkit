import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Public from "@spiko/public-api-client"
import { Console, Effect, Layer, Option, Queue, Terminal } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { describe, expect, it } from "vitest"
import { Command, Flag } from "effect/unstable/cli"
import { type DefinedOperation, defineOperation, makeCli } from "../src/cli.ts"
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

// A minimal synthetic mutation used to exercise the local --confirm gate and
// its remediation suggestion without relying on a specific API family. The
// invoke closure keeps the Public client requirement so the CLI wiring stays
// identical to a generated operation; it is never reached because the gate
// rejects the invocation locally.
const MutatingThing = defineOperation({
  confirmed: (input) => input["confirm"],
  definition: {
    action: "create",
    description: "Create Thing",
    family: "public",
    method: "POST",
    operationId: "things.create",
    parameters: [],
    path: "/things",
    requestBody: null,
    resource: "things",
    responses: [
      {
        content: [],
        description: "Success",
        status: "200",
      },
    ],
    safety: "mutation",
  },
  invoke: () => Effect.flatMap(Public.PublicApi, (client) => client.GetAllFunds(undefined)),
  parameters: {
    confirm: Flag.boolean("confirm").pipe(
      Flag.withDescription("Confirm this mutating Spiko Operation"),
    ),
  },
  prepare: (input) => Effect.succeed(input),
})

const makeMutatingTestCli = () =>
  makeCli({
    operationLayers: {
      distributor: Layer.empty,
      investor: Layer.empty,
      public: PublicUnusedLayer,
    },
    operations: {
      distributor: noOperations(),
      investor: noOperations(),
      public: [MutatingThing],
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
        .run(["call", "public", "funds", "get", "--fund-id", fundId], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(calls).toEqual([`/v0/funds/${fundId}`])
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    // Outside agent mode the raw API payload is printed without an envelope.
    expect(JSON.parse(stdout[0] ?? "")).toEqual(fund)
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
        .run(["call", "public", "funds", "get", "--fund-id", fundId], { env: {} })
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
        .run(["call", "public", "funds", "get", "--fund-id", fundId], { env: {} })
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
        .run(["call", "public", "funds", "get", "--fund-id", "not-a-uuid"], { env: {} })
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
        .run(["operations", "describe", "public", "Get Fund"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    // Outside agent mode the raw definition is printed without an envelope.
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
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
    })
  })

  it("rejects the wizard without an interactive terminal", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["--wizard"], { env: {} })
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
          .run(["--wizard"], { env: {} })
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
    // The wizard runs outside agent mode, so the raw fund payload is printed.
    expect(stdout.some((message) => message.includes('"slug": "EUTBL"'))).toBe(true)
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
          .run(["--wizard"], { env: {} })
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
        .run(["call", "public", "funds", "get", "--help"], { env: {} })
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

  it("replaces text help with a scoped JSON schema in agent mode", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "get", "--help"], { env: { FORCE_AGENT_MODE: "1" } })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const schema = JSON.parse(stdout[0] ?? "")
    expect(schema.scope).toBe("call public funds get")
    expect(schema.commands).toEqual([
      {
        family: "public",
        resources: [
          {
            resource: "funds",
            actions: [expect.objectContaining({ action: "get", operationId: "Get Fund" })],
          },
        ],
      },
    ])
    expect(schema.best_practices.length).toBeGreaterThan(0)
    expect(schema.script_authoring.rule).toContain("--no-agent")
  })

  it("emits a full and a compact machine-readable schema via 'agent schema'", async () => {
    const cli = makeTestCli(PublicUnusedLayer)

    const runSchema = async (args: ReadonlyArray<string>) => {
      const stdout: Array<string> = []
      const stderr: Array<string> = []
      const exitCode = await Effect.runPromise(
        cli
          .run(args, { env: {} })
          .pipe(
            Effect.provide(NodeServices.layer),
            Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
          ),
      )
      expect(exitCode).toBe(0)
      return JSON.parse(stdout[0] ?? "")
    }

    const full = await runSchema(["agent", "schema"])
    const action = full.commands[0].resources[0].actions[0]
    expect(action).toMatchObject({
      action: "get",
      method: "GET",
      operationId: "Get Fund",
      safety: "read",
    })
    expect(action.flags).toEqual([expect.objectContaining({ flag: "--fund-id", required: true })])
    expect(full.usage.length).toBeGreaterThan(0)

    const compact = await runSchema(["agent", "schema", "--compact"])
    const compactAction = compact.commands[0].resources[0].actions[0]
    expect(compactAction.command).toBe("spiko call public funds get")
    expect(compactAction.flags).toEqual(["--fund-id"])
  })

  it("summarizes an Operation without JSON Schemas via --summary", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["operations", "describe", "public", "Get Fund", "--summary"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    const described = JSON.parse(stdout[0] ?? "")
    expect(described.operationId).toBe("Get Fund")
    expect(described.responses).toEqual([
      { description: "Success", status: "200" },
      { description: "The request did not match the expected schema", status: "400" },
      { description: "NotFound", status: "404" },
    ])
    // Parameter schemas stay out of the summary; exact shapes remain available
    // through the non-summary describe.
    expect(JSON.stringify(described)).not.toContain('"format": "uuid"')
  })

  it("suggests remediation steps in failure envelopes", async () => {
    const stderr: Array<string> = []
    const stdout: Array<string> = []
    // Unknown subcommand inside a wired family surfaces parser suggestions
    // plus a discovery hint.
    const cli = makeTestCli(PublicUnusedLayer)
    await Effect.runPromise(
      cli
        .run(["call", "public", "fund", "get"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )
    const unknownFamilyFailure = JSON.parse(stderr[0] ?? "")
    expect(unknownFamilyFailure.ok).toBe(false)
    expect(unknownFamilyFailure.error.suggestions).toContain(
      "Run 'spiko agent schema' to list commands and flags.",
    )

    // A mutating operation rejected locally points straight at --confirm.
    const mutatingCli = makeMutatingTestCli()
    const confirmStderr: Array<string> = []
    await Effect.runPromise(
      mutatingCli
        .run(["call", "public", "things", "create"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole([], confirmStderr)),
        ),
    )
    const confirmFailure = JSON.parse(confirmStderr[0] ?? "")
    expect(confirmFailure.error.code).toBe("invalid-input")
    expect(confirmFailure.error.suggestions).toEqual([
      "Re-run with --confirm to allow this mutating Spiko Operation.",
    ])
  })

  it("keeps the operation-specific describe hint for parser failures", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    await Effect.runPromise(
      cli
        // Missing required --fund-id: a ShowHelp parse failure whose child
        // errors carry no command path of their own.
        .run(["call", "public", "funds", "get"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    const failure = JSON.parse(stderr[0] ?? "")
    expect(failure.ok).toBe(false)
    expect(failure.operation).toBe("Get Fund")
    expect(failure.error.suggestions).toContain(
      `Run 'spiko operations describe public "Get Fund"' for exact input requirements.`,
    )
  })

  it("lists generated Public Operations as JSON", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const cli = makeTestCli(PublicUnusedLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["operations", "list", "public"], { env: {} })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(stdout).toHaveLength(1)
    const items = JSON.parse(stdout[0] ?? "")
    expect(items).toHaveLength(15)
    expect(items).toContainEqual({
      action: "get",
      command: "spiko call public funds get",
      description: "Get Fund",
      method: "GET",
      operationId: "Get Fund",
      path: "/funds/{fundId}",
      resource: "funds",
    })
  })

  it("wraps success output in an agent envelope when agent mode is on", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const publicLayer = makePublicLayer((request) =>
      Effect.sync(() => jsonResponse(request, [fund, fund])),
    )
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["call", "public", "funds", "list"], { env: { FORCE_AGENT_MODE: "1" } })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    const envelope = JSON.parse(stdout[0] ?? "")
    expect(envelope.ok).toBe(true)
    expect(envelope.operation).toBe("Get all Funds")
    expect(envelope.data).toHaveLength(2)
    expect(envelope.metadata).toMatchObject({
      command: "call public funds list",
      count: 2,
    })
    expect(envelope.metadata.note).toContain("--no-agent")
  })

  it("prints the raw payload when --no-agent overrides a detected agent", async () => {
    const stdout: Array<string> = []
    const stderr: Array<string> = []
    const publicLayer = makePublicLayer((request) => Effect.sync(() => jsonResponse(request, fund)))
    const cli = makeTestCli(publicLayer)

    const exitCode = await Effect.runPromise(
      cli
        .run(["--no-agent", "call", "public", "funds", "get", "--fund-id", fundId], {
          env: { CLAUDECODE: "1" },
        })
        .pipe(
          Effect.provide(NodeServices.layer),
          Effect.provideService(Console.Console, makeTestConsole(stdout, stderr)),
        ),
    )

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout[0] ?? "")).toEqual(fund)
    expect(JSON.parse(stdout[0] ?? "")).not.toHaveProperty("metadata")
  })
})
