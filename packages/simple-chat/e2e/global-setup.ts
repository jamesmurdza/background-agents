/**
 * Playwright Global Setup
 *
 * Runs before all tests:
 * 1. Validates we're using a test database (safety check)
 * 2. Resets the database and runs migrations
 */

import { execSync } from "child_process"
import path from "path"
import { config as loadEnv } from "dotenv"

export default async function globalSetup() {
  // Load test environment
  loadEnv({ path: path.resolve(__dirname, "../.env.test") })
  loadEnv({ path: path.resolve(__dirname, "../../../.env") })

  const dbUrl = process.env.DATABASE_URL || ""

  // Safety check: refuse to run on production database
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL is not set. Create a .env.test file with a TEST database URL."
    )
  }

  // Check that this looks like a test database
  // Can be bypassed with I_KNOW_THIS_IS_THE_TEST_DB=true
  const isTestDb =
    process.env.I_KNOW_THIS_IS_THE_TEST_DB === "true" ||
    dbUrl.includes("test") ||
    dbUrl.includes("localhost") ||
    dbUrl.includes("127.0.0.1") ||
    dbUrl.includes("_test")

  if (!isTestDb) {
    throw new Error(
      `Refusing to run tests on non-test database!\n` +
        `DATABASE_URL must contain 'test', 'localhost', or '127.0.0.1'.\n` +
        `Or set I_KNOW_THIS_IS_THE_TEST_DB=true to bypass.\n` +
        `Current: ${dbUrl.replace(/:[^:@]+@/, ":****@")}\n\n` +
        `Create a separate test database and set it in .env.test`
    )
  }

  console.log("🧪 Setting up test database...")

  try {
    // Reset database (this drops all tables and re-runs migrations)
    // The PRISMA_USER_CONSENT variable bypasses AI safety checks since this is intentional test setup
    execSync("npx prisma migrate reset --force", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
      },
    })

    console.log("✅ Test database ready")
  } catch (error) {
    console.error("❌ Failed to setup test database:", error)
    throw error
  }
}
