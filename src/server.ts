import { Layer, Logger } from "effect"
import { NodeHttpClient, NodeStdio } from "@effect/platform-node"
import { McpServer } from "effect/unstable/ai"
import { layer as SpikoApiLayer } from "./spiko-api.ts"
import { SpikoHandlers, SpikoToolkit } from "./tools.ts"

const ToolLayer = McpServer.toolkit(SpikoToolkit).pipe(
  Layer.provide(SpikoHandlers),
  Layer.provide(SpikoApiLayer),
  Layer.provide(NodeHttpClient.layerUndici),
)

export const ServerLayer = ToolLayer.pipe(
  Layer.provide(
    McpServer.layerStdio({
      name: "spiko-mcp-server",
      version: "0.1.0",
    }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
)
