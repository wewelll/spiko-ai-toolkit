import { layer as PublicApiLayer } from "@spiko/public-api-client"
import { Effect, Stdio } from "effect"
import packageJson from "../package.json" with { type: "json" }
import { makeCli } from "./cli.ts"
import { PublicOperations } from "./generated/public.ts"

const cli = makeCli({
  operationLayer: PublicApiLayer,
  operations: PublicOperations,
  version: packageJson.version,
})

export const rootCommand = cli.rootCommand
export const run = cli.run
export const program = Effect.flatMap(Stdio.Stdio, (stdio) => Effect.flatMap(stdio.args, run))
