import { Console, Effect, FileSystem, Layer, Option, Path, Stdio, Terminal } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { type DefinedOperation, type SpikoFamily } from "../src/cli.ts"

// Annotated (not a bare []) so makeCli's requirement generics infer `never`
// instead of `unknown` when only one family is under test.
export const noOperations = <Family extends SpikoFamily>(): ReadonlyArray<
  DefinedOperation<Family>
> => []

export const makeTestConsole = (stdout: Array<string>, stderr: Array<string>): Console.Console =>
  Object.assign(Object.create(console), {
    error: (...args: ReadonlyArray<unknown>) => stderr.push(args.join(" ")),
    log: (...args: ReadonlyArray<unknown>) => stdout.push(args.join(" ")),
  })

export const deadHttpClient = HttpClient.make(() => Effect.die("not executed"))

export const observedError = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({
    description: "observed",
    request: HttpClientRequest.get("https://spiko.example.test/observed"),
  }),
})

export const recordThenStop = (calls: Array<unknown>, call: unknown) =>
  Effect.sync(() => calls.push(call)).pipe(Effect.flatMap(() => Effect.fail(observedError)))

export const key = (name: string, input = Option.none<string>()): Terminal.UserInput => ({
  input,
  key: { ctrl: false, meta: false, name, shift: false },
})

export const wizardEnvironment = (terminal: Terminal.Terminal, interactive = true) =>
  Layer.mergeAll(
    FileSystem.layerNoop({}),
    Path.layer,
    Stdio.layerTest({
      stdinIsTerminal: Effect.succeed(interactive),
      stdoutIsTerminal: Effect.succeed(interactive),
    }),
    Layer.succeed(Terminal.Terminal, terminal),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("unused")),
    ),
  )
