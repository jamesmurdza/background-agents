/**
 * Verifies the Environment backfill against the source blob it was built from.
 *
 * For every user with repoEnvironmentVariables, checks that each repo key has
 * exactly one Default environment whose variables decrypt to the same values.
 * Run after applying the migration locally, and once against a production
 * clone before the deploy.
 *
 *   npx tsx scripts/verify-environment-backfill.ts
 */
import path from "node:path"

import { Prisma, PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { config as loadEnv } from "dotenv"
import pg from "pg"

import { decrypt } from "../lib/db/encryption"

// Same precedence as prisma.config.ts and Next itself: .env.local beats .env,
// so running this with no arguments hits the same database the app does.
const exported = process.env.DATABASE_URL
const packageDir = path.join(__dirname, "..")
loadEnv({ path: path.join(packageDir, ".env") })
loadEnv({ path: path.join(packageDir, ".env.local"), override: true })
if (exported) process.env.DATABASE_URL = exported

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")

// Say out loud which database is about to be read.
console.log(`Database: ${connectionString.replace(/:\/\/[^@]*@/, "://***@")}`)

const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString, max: 5 })),
})

async function main() {
  const users = await prisma.user.findMany({
    where: { NOT: { repoEnvironmentVariables: { equals: Prisma.DbNull } } },
    select: { id: true, repoEnvironmentVariables: true },
  })

  let checked = 0
  const problems: string[] = []

  for (const user of users) {
    const blob = (user.repoEnvironmentVariables ?? {}) as Record<
      string,
      Record<string, string>
    >
    for (const [repo, vars] of Object.entries(blob)) {
      const envs = await prisma.environment.findMany({
        where: { userId: user.id, repo, isDefault: true },
      })
      if (envs.length !== 1) {
        problems.push(
          `${user.id} ${repo}: expected 1 default env, found ${envs.length}`
        )
        continue
      }
      const stored = (envs[0].environmentVariables ?? {}) as Record<
        string,
        string
      >
      for (const [key, cipher] of Object.entries(vars)) {
        if (decrypt(stored[key] ?? "") !== decrypt(cipher)) {
          problems.push(`${user.id} ${repo}: value mismatch for ${key}`)
        }
      }
      checked++
    }
  }

  console.log(
    `Checked ${checked} (user, repo) pairs across ${users.length} users.`
  )
  if (problems.length) {
    console.error(`${problems.length} problems:`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log("Backfill verified.")
}

main().finally(() => prisma.$disconnect())
