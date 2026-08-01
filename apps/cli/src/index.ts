#!/usr/bin/env node

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect } from "effect"
import { program } from "./program.ts"

program.pipe(Effect.provide([NodeHttpClient.layerUndici, NodeServices.layer]), NodeRuntime.runMain)
