/**
 * Run ccauth in a Daytona sandbox to mint Claude credentials.
 *
 * Exactly one input is required:
 *   --cookies-path <path>    claude.ai cookies JSON → cookie-based (browser) flow
 *   --refresh-token <token>  existing refresh token → refresh flow (no browser)
 *
 * Modes:
 *   default   generate creds, print JSON to stdout (no DB)
 *   --seed    also upsert the resulting creds row (and, in cookie mode, the
 *             cookies row) into the CcAuthInfo table
 *
 * Usage:
 *   npm run test:ccauth -- --cookies-path ./cookies.json
 *   npm run test:ccauth -- --refresh-token sk-ant-ort01-...
 *   npm run seed:ccauth -- --cookies-path ./cookies.json
 *
 * Required env (loaded via tsx --env-file=.env.local):
 *   DAYTONA_API_KEY
 *   DATABASE_URL or POSTGRES_URL  (only when --seed is passed)
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  generateClaudeCredentials,
  CLAUDE_CREDS_KEY,
  CLAUDE_COOKIES_KEY,
} from "@background-agents/claude-credentials"

const USAGE =
  "usage: tsx scripts/run-ccauth.ts (--cookies-path <path> | --refresh-token <token>) [--seed]"

/** Reads `--flag value` or `--flag=value`; ignores a following token that is itself a flag. */
function getFlag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  if (i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")) {
    return args[i + 1]
  }
  return undefined
}

async function main() {
  const args = process.argv.slice(2)
  const seed = args.includes("--seed")
  const cookiesPath = getFlag(args, "--cookies-path")
  const refreshToken = getFlag(args, "--refresh-token")

  if (!cookiesPath && !refreshToken) {
    console.error(`At least one of --cookies-path or --refresh-token is required.\n${USAGE}`)
    process.exit(1)
  }
  if (cookiesPath && refreshToken) {
    console.error(`Provide only one of --cookies-path or --refresh-token.\n${USAGE}`)
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

  // Cookie mode: read + sanity-check the cookies file before sending it into a sandbox.
  let cookies: string | undefined
  if (cookiesPath) {
    cookies = readFileSync(resolve(cookiesPath), "utf8")
    JSON.parse(cookies)
  }

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

  // Seed the cookies row up front — cookie mode only; refresh mode has no cookies.
  if (seed && cookies) {
    console.error(`→ Upserting cookies row (${CLAUDE_COOKIES_KEY})`)
    await upsert(CLAUDE_COOKIES_KEY, cookies)
  }

  console.error(
    `→ Running ccauth in Daytona (${cookiesPath ? "cookie-based" : "refresh"} flow; first run can take a few minutes)`,
  )
  const t0 = Date.now()
  const creds = cookiesPath
    ? await generateClaudeCredentials({ cookies: cookies! })
    : await generateClaudeCredentials({ refreshToken: refreshToken! })
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
