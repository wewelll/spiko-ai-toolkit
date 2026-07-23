import { defineConfig } from "rolldown"

export default defineConfig({
  input: {
    generated: "src/generated.ts",
    index: "src/index.ts",
  },
  external: [/^effect(?:\/|$)/],
  output: {
    dir: "dist",
    format: "esm",
  },
  platform: "node",
})
