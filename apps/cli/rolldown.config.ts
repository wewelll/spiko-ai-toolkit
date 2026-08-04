import { defineConfig } from "rolldown"

export default defineConfig({
  external: ["@napi-rs/keyring"],
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "esm",
  },
  platform: "node",
})
