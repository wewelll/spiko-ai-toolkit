#!/usr/bin/env node

import { Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { ServerLayer } from "./server.ts"

NodeRuntime.runMain(Layer.launch(ServerLayer))
