import { layer as InvestorApiLayer } from "@spiko/investor-api-client"
import { layer as PublicApiLayer } from "@spiko/public-api-client"
import { Effect, Layer, Stdio } from "effect"
import packageJson from "../package.json" with { type: "json" }
import { type DefinedOperation, makeCli } from "./cli.ts"
import { InvestorOperations } from "./generated/investor.ts"
import { PublicOperations } from "./generated/public.ts"

const NoDistributorOperations: ReadonlyArray<DefinedOperation<"distributor">> = []
const cli = makeCli({
  operationLayers: {
    distributor: Layer.empty,
    investor: InvestorApiLayer,
    public: PublicApiLayer,
  },
  operations: {
    distributor: NoDistributorOperations,
    investor: InvestorOperations,
    public: PublicOperations,
  },
  version: packageJson.version,
})

export const rootCommand = cli.rootCommand
export const run = cli.run
export const program = Effect.flatMap(Stdio.Stdio, (stdio) => Effect.flatMap(stdio.args, run))
