import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@spiko/distributor-api-client": fileURLToPath(
        new URL("../../packages/distributor-api-client/src/index.ts", import.meta.url),
      ),
      "@spiko/investor-api-client": fileURLToPath(
        new URL("../../packages/investor-api-client/src/index.ts", import.meta.url),
      ),
      "@spiko/public-api-client": fileURLToPath(
        new URL("../../packages/public-api-client/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
})
