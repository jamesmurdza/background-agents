import { defineConfig } from "@playwright/test"
import { config as loadEnv } from "dotenv"
import path from "node:path"

// Load test environment first, then fall back to root .env
loadEnv({ path: path.resolve(__dirname, ".env.test") })
loadEnv({ path: path.resolve(__dirname, "../../.env") })

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
    command: `npm run dev`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Test database (MUST be separate from production!)
      DATABASE_URL: process.env.DATABASE_URL!,
      // Bypass safety check if set
      I_KNOW_THIS_IS_THE_TEST_DB: process.env.I_KNOW_THIS_IS_THE_TEST_DB || "",
      // Daytona
      DAYTONA_API_KEY: process.env.DAYTONA_API_KEY!,
      // Auth
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "test-secret-for-e2e-tests",
      NEXTAUTH_URL: `http://localhost:${port}`,
      GITHUB_CLIENT_ID: "placeholder",
      GITHUB_CLIENT_SECRET: "placeholder",
      // Enable test auth route
      ENABLE_TEST_AUTH: "true",
    },
  },
})
