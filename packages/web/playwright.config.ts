import { defineConfig } from "@playwright/test"
import { config as loadEnv } from "dotenv"
import path from "node:path"

// Load DAYTONA_API_KEY from the root .env (the only thing we need from there)
loadEnv({ path: path.resolve(__dirname, "../../.env") })
// Load test-specific config (DB, auth) — overrides root .env
loadEnv({ path: path.resolve(__dirname, ".env.e2e"), override: true })

const testDbUrl = process.env.DATABASE_URL!
const port = 3001

const webServerEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
  ),
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: testDbUrl,
  DATABASE_URL_UNPOOLED: testDbUrl,
  NEXTAUTH_URL: `http://localhost:${port}`,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  DAYTONA_API_KEY: process.env.DAYTONA_API_KEY!,
  GITHUB_CLIENT_ID: "placeholder",
  GITHUB_CLIENT_SECRET: "placeholder",
}

// Same JSON blob as Settings → Claude subscription; must use env (not shell) so quotes survive.
if (process.env.E2E_CLAUDE_OAUTH_JSON?.trim()) {
  webServerEnv.E2E_CLAUDE_OAUTH_JSON = process.env.E2E_CLAUDE_OAUTH_JSON
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 2 * 60_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx next dev --port ${port}`,
    env: webServerEnv,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
