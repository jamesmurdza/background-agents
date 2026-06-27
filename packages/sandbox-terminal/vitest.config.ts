import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests boot a real Daytona sandbox; they need plenty of time
    // both to start (sandbox creation + npm install of node-pty) and to tear down.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Don't run multiple integration files in parallel — each one stands up a
    // real sandbox and we don't want to fan out cloud resources.
    fileParallelism: false,
  },
})
