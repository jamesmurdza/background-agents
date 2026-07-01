/**
 * Run ccauth in a Daytona sandbox against a local cookies file.
 *
 * Modes:
 *   default       generate creds, print JSON to stdout (no DB)
 *   --seed        rotate the cookies + credentials rows in the CcAuthInfo table
 *
 * Use --seed to rotate the claude.ai cookies once they expire: it upserts the
 * new cookies, regenerates the OAuth credentials from them, and stores both.
 *
 * Usage:
 *   npm run test:ccauth -- ./cookies.json
 *   npm run seed:ccauth -- ./cookies.json
 *
 * Required env (loaded via tsx --env-file=.env.local):
 *   DAYTONA_API_KEY
 *   DATABASE_URL or POSTGRES_URL  (only when --seed is passed)
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { generateClaudeCredentials } from "@background-agents/claude-credentials"

async function main() {
  const args = process.argv.slice(2)
  const seed = args.includes("--seed")
  const cookiesPath = args.find((a) => !a.startsWith("--"))

  if (!cookiesPath) {
    console.error(
      "usage: tsx scripts/run-ccauth.ts <path-to-cookies.json> [--seed]",
    )
    process.exit(1)
  }
  if (!process.env.DAYTONA_API_KEY) {
    console.error("DAYTONA_API_KEY is not set (expected in .env.local)")
    process.exit(1)
  }
  if (seed && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error(
      "DATABASE_URL or POSTGRES_URL is not set (expected in .env.local)",
    )
    process.exit(1)
  }

  const cookies = readFileSync(resolve(cookiesPath), "utf8")
  JSON.parse(cookies) // sanity check before sending into a sandbox

  if (!seed) {
    // Test mode: generate and print, no DB. Kept dependency-free so it doesn't
    // require DATABASE_URL or pull in Prisma.
    console.error(
      "→ Running ccauth in Daytona (first run can take a few minutes)",
    )
    const t0 = Date.now()
    const creds = await generateClaudeCredentials(cookies)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(JSON.stringify(creds, null, 2))
    const expiresAt = new Date(creds.claudeAiOauth.expiresAt).toISOString()
    console.error(`✓ Done in ${elapsed}s. Token expires at ${expiresAt}`)
    return
  }

  // Seed mode: delegate to the same modules the cron uses so cookie/credential
  // writes stay in one place. Lazy import so test mode never touches Prisma.
  // setCookies/prismaDisconnect live in the data-access layer; refreshCredentials
  // (which reaches the heavy generator) lives in the server orchestration module.
  const { setCookies, prismaDisconnect } = await import(
    "../lib/claude-credentials"
  )
  const { refreshCredentials } = await import(
    "../lib/server/refresh-claude-credentials"
  )

  console.error("→ Upserting cookies row")
  await setCookies(cookies)

  console.error(
    "→ Running ccauth in Daytona (first run can take a few minutes)",
  )
  const t0 = Date.now()
  const result = await refreshCredentials({ force: true })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  if (result.status === "error") {
    console.error(`✗ ${result.code}: ${result.message}`)
    await prismaDisconnect()
    process.exit(1)
  }

  const expiresAt = new Date(result.expiresAt).toISOString()
  console.error(`✓ Done in ${elapsed}s. Token expires at ${expiresAt}`)
  await prismaDisconnect()
}

main().catch((err) => {
  console.error("run-ccauth failed:", err)
  process.exit(1)
})
