import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Sandbox spin-up + a ~10s command + reconnect polling need generous time.
    testTimeout: 240_000,
    hookTimeout: 120_000,
    // These tests create real Daytona sandboxes; never run them in parallel.
    fileParallelism: false,
  },
})
