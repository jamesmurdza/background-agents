import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// Vitest setup for the web package. Pure-logic unit tests live next to the code
// they cover as `*.test.ts`. The `@/*` alias mirrors tsconfig so imports match
// the rest of the app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
})
