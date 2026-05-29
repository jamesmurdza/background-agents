import { defineConfig } from "@playwright/test"
import { config as loadEnv } from "dotenv"
import path from "node:path"

// Load test environment first, then fall back to root .env.local (shared with dev)
loadEnv({ path: path.resolve(__dirname, ".env.test") })
loadEnv({ path: path.resolve(__dirname, "../../.env.local") })

const port = 4000

export default defineConfig({
  testDir: "./e2e",
  timeout: 3 * 60_000, // 3 minutes per test (sandbox creation can be slow)
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  // Global setup/teardown for database
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // The webServer inherits process.env, which is already populated by
    // the loadEnv() calls above (.env.test wins, root .env.local fills gaps).
    // No explicit env block needed.
    command: `npm run dev`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
