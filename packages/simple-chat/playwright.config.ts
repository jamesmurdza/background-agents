import { defineConfig } from "@playwright/test"
import { config as loadEnv } from "dotenv"
import path from "node:path"

// Load DAYTONA_API_KEY from the root .env if it exists
loadEnv({ path: path.resolve(__dirname, "../../.env") })

const port = 4000

export default defineConfig({
  testDir: "./e2e",
  timeout: 3 * 60_000, // 3 minutes per test (sandbox creation can be slow)
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npm run dev`,
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DAYTONA_API_KEY: process.env.DAYTONA_API_KEY!,
      NEXTAUTH_SECRET: "test-secret-for-e2e",
      NEXTAUTH_URL: `http://localhost:${port}`,
      GITHUB_CLIENT_ID: "placeholder",
      GITHUB_CLIENT_SECRET: "placeholder",
    },
  },
})
