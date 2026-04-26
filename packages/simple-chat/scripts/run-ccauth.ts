/**
 * Run ccauth in a Daytona sandbox against a local cookies file.
 *
 * Modes:
 *   default       generate creds, print JSON to stdout (no DB)
 *   --seed        also upsert cookies + creds rows into the CcAuthInfo table
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
import {
  CLAUDE_COOKIES_KEY,
  CLAUDE_CREDS_KEY,
  generateClaudeCredentials,
} from "../lib/claude-credentials"

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

  // Lazy: only import (and connect to) Prisma in --seed mode so test mode
  // doesn't require DATABASE_URL.
  const db = seed ? await import("../lib/db/prisma") : null

  const upsert = async (id: string, value: string) => {
    if (!db) return
    await db.prisma.ccAuthInfo.upsert({
      where: { id },
      create: { id, value },
      update: { value },
    })
  }

  if (seed) {
    console.error(`→ Upserting cookies row (${CLAUDE_COOKIES_KEY})`)
    await upsert(CLAUDE_COOKIES_KEY, cookies)
  }

  console.error(
    "→ Running ccauth in Daytona (first run can take a few minutes)",
  )
  const t0 = Date.now()
  const creds = await generateClaudeCredentials(cookies)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  if (seed) {
    console.error(`→ Upserting credentials row (${CLAUDE_CREDS_KEY})`)
    await upsert(CLAUDE_CREDS_KEY, JSON.stringify(creds))
  } else {
    console.log(JSON.stringify(creds, null, 2))
  }

  const expiresAt = new Date(creds.claudeAiOauth.expiresAt).toISOString()
  console.error(`✓ Done in ${elapsed}s. Token expires at ${expiresAt}`)

  if (db) await db.prisma.$disconnect()
}

main().catch((err) => {
  console.error("run-ccauth failed:", err)
  process.exit(1)
})
