import { Layer, Logger } from "effect"
import { NodeHttpClient, NodeStdio } from "@effect/platform-node"
import { layer as PublicApiLayer } from "@spiko/public-api-client"
import { McpProtocol, McpServer } from "effect/unstable/ai"
import { SpikoHandlers, SpikoToolkit } from "./tools.ts"

const ToolLayer = McpServer.toolkit(SpikoToolkit).pipe(
  Layer.provide(SpikoHandlers),
  Layer.provide(PublicApiLayer),
  Layer.provide(NodeHttpClient.layerUndici),
)

export const ServerLayer = ToolLayer.pipe(
  Layer.provide(
    McpServer.layerStdio({
      name: "spiko-mcp-server",
      protocols: [McpProtocol.v2025_06_18],
      version: "0.2.0",
    }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
)
