import { layer as DistributorApiLayer } from "@spiko/distributor-api-client"
import { layer as InvestorApiLayer } from "@spiko/investor-api-client"
import { layer as PublicApiLayer } from "@spiko/public-api-client"
import { Effect, Stdio } from "effect"
import packageJson from "../package.json" with { type: "json" }
import { makeCli } from "./cli.ts"
import { DistributorOperations } from "./generated/distributor.ts"
import { InvestorOperations } from "./generated/investor.ts"
import { PublicOperations } from "./generated/public.ts"

const cli = makeCli({
  operationLayers: {
    distributor: DistributorApiLayer,
    investor: InvestorApiLayer,
    public: PublicApiLayer,
  },
  operations: {
    distributor: DistributorOperations,
    investor: InvestorOperations,
    public: PublicOperations,
  },
  version: packageJson.version,
})

export const rootCommand = cli.rootCommand
export const run = cli.run
export const program = Effect.flatMap(Stdio.Stdio, (stdio) => Effect.flatMap(stdio.args, run))
