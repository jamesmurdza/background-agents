import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const isBuildTime = process.env.NEXT_PHASE === "phase-production-build"

  // At build time, use a placeholder URL - the client won't actually connect
  const connectionString = isBuildTime
    ? "postgresql://placeholder:placeholder@localhost:5432/placeholder"
    : (process.env.DATABASE_URL ?? process.env.POSTGRES_URL)

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL environment variable is not set"
    )
  }

  // Neon requires its WebSocket adapter; local Postgres AND Supabase are
  // standard Postgres and use the node-postgres (pg) adapter.
  const isNeon = connectionString.includes("neon.tech")

  if (!isNeon) {
    // Keep the per-instance pool small in production: on serverless each warm
    // instance holds its own pool, and Supabase's transaction pooler (Supavisor)
    // does the real connection fan-in.
    const pool = new pg.Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 1 : 10,
    })
    const adapter = new PrismaPg(pool)
    return new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["error", "warn"]
          : ["error"],
    })
  }

  const adapter = new PrismaNeon({ connectionString })

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })
}

export const prisma = globalThis.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma
