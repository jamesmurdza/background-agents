import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // One shared sandbox + a ~6s command observed concurrently, with a hard
    // in-harness deadline. Test bodies are bounded; the timeout is just a
    // backstop so a wedged Daytona call can't hang CI forever.
    testTimeout: 90_000,
    // Sandbox spin-up (beforeAll) is the one genuinely slow step.
    hookTimeout: 120_000,
    // These tests create real Daytona sandboxes; never run them in parallel.
    fileParallelism: false,
  },
})
