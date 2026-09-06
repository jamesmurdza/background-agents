import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// Mirror the `@/*` -> `./*` path alias from tsconfig.json so unit tests can
// import modules that use the `@/` alias.
export default defineConfig({
  test: {
    // `e2e/` holds Playwright specs (run via `npm run test:e2e`); they must not
    // be collected by vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // Next.js special-cases the `server-only` import at build time; it isn't
      // a real package in node_modules for Vitest to resolve on its own.
      // Point it at Next's vendored no-op so server-only modules can be unit
      // tested outside the Next.js build pipeline.
      "server-only": "next/dist/compiled/server-only/empty.js",
    },
  },
})
