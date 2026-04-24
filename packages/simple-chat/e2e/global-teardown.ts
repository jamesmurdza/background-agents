/**
 * Playwright Global Teardown
 *
 * Runs after all tests:
 * 1. Cleans up any sandboxes created during tests
 * 2. Optionally clears test data
 */

export default async function globalTeardown() {
  console.log("🧹 Cleaning up after tests...")

  // Sandboxes auto-cleanup via Daytona TTL, but we could add explicit cleanup here
  // if needed in the future

  console.log("✅ Cleanup complete")
}
