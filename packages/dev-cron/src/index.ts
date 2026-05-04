#!/usr/bin/env node

/**
 * Dev Cron Simulator
 *
 * Reads cron jobs from vercel.json and runs them locally on the configured schedule.
 * Useful for testing cron endpoints during development.
 *
 * Usage:
 *   npx tsx packages/dev-cron/src/index.ts
 *   npm run dev:cron (if configured in root package.json)
 *
 * Environment variables:
 *   CRON_SECRET  - Bearer token for cron endpoints (default: "dev-secret")
 *   BASE_URL     - Base URL for the dev server (default: "http://localhost:3000")
 *   VERCEL_JSON  - Path to vercel.json (default: "./vercel.json")
 */

import { readFileSync, existsSync } from "fs"
import { join, resolve, dirname } from "path"
import { cronToMs, formatInterval } from "./parser.js"

/**
 * Find the repository root by looking for package.json with workspaces
 */
function findRepoRoot(): string {
  let dir = process.cwd()
  while (dir !== "/") {
    const pkgPath = join(dir, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
        if (pkg.workspaces) {
          return dir
        }
      } catch {}
    }
    dir = dirname(dir)
  }
  return process.cwd()
}

interface VercelCron {
  path: string
  schedule: string
}

interface VercelConfig {
  crons?: VercelCron[]
}

const CRON_SECRET = process.env.CRON_SECRET || "dev-secret"
const BASE_URL = process.env.BASE_URL || "http://localhost:4000"
const VERCEL_JSON = process.env.VERCEL_JSON || "./vercel.json"

function loadVercelConfig(): VercelConfig {
  const repoRoot = findRepoRoot()

  // Try multiple paths to find vercel.json
  const paths = [
    resolve(process.cwd(), VERCEL_JSON),
    resolve(process.cwd(), "vercel.json"),
    resolve(repoRoot, "vercel.json"),
    resolve(repoRoot, "packages/web/vercel.json"),
  ]

  for (const configPath of paths) {
    if (existsSync(configPath)) {
      console.log(`Loading config from: ${configPath}\n`)
      return JSON.parse(readFileSync(configPath, "utf-8"))
    }
  }

  throw new Error(
    `Could not find vercel.json. Tried:\n${paths.map((p) => `  - ${p}`).join("\n")}`
  )
}

async function runCron(cron: VercelCron): Promise<void> {
  const timestamp = new Date().toISOString()
  const url = `${BASE_URL}${cron.path}`

  try {
    const start = Date.now()
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
    })

    const elapsed = Date.now() - start
    const status = res.status

    let body: unknown
    const contentType = res.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      body = await res.json()
    } else {
      body = await res.text()
    }

    if (res.ok) {
      console.log(`[${timestamp}] ✓ ${cron.path} (${status}, ${elapsed}ms)`)
      if (body && typeof body === "object") {
        console.log(`  ${JSON.stringify(body)}`)
      }
    } else {
      console.log(`[${timestamp}] ✗ ${cron.path} (${status}, ${elapsed}ms)`)
      console.log(`  ${JSON.stringify(body)}`)
    }
  } catch (err) {
    console.log(`[${timestamp}] ✗ ${cron.path} (failed)`)
    console.log(`  ${err instanceof Error ? err.message : String(err)}`)
  }
}

function startCron(cron: VercelCron): void {
  const intervalMs = cronToMs(cron.schedule)

  console.log(
    `  ${cron.path}\n` +
      `    Schedule: ${cron.schedule}\n` +
      `    Interval: ${formatInterval(intervalMs)}`
  )

  // Run immediately
  runCron(cron)

  // Then run on interval
  setInterval(() => runCron(cron), intervalMs)
}

function main(): void {
  console.log("╔═══════════════════════════════════════╗")
  console.log("║       Dev Cron Simulator              ║")
  console.log("╚═══════════════════════════════════════╝")
  console.log()
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Cron Secret: ${CRON_SECRET.slice(0, 4)}${"*".repeat(Math.max(0, CRON_SECRET.length - 4))}`)
  console.log()

  const config = loadVercelConfig()
  const crons = config.crons || []

  if (crons.length === 0) {
    console.log("No crons found in vercel.json")
    process.exit(0)
  }

  console.log(`Found ${crons.length} cron job(s):\n`)

  for (const cron of crons) {
    startCron(cron)
  }

  console.log("\n─────────────────────────────────────────")
  console.log("Press Ctrl+C to stop\n")
}

main()
