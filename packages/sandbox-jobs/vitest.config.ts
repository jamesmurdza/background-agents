import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One shared sandbox + short sleep-based commands, with a hard in-harness
    // deadline. The timeout is just a backstop so a wedged Daytona call can't
    // hang CI forever.
    testTimeout: 90_000,
    hookTimeout: 120_000,
    // These tests create real Daytona sandboxes; never run them in parallel.
    fileParallelism: false,
  },
})
