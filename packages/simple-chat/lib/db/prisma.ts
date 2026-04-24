import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaPg } from "@prisma/adapter-pg"
import pg from "pg"

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL environment variable is not set"
    )
  }

  // Use pg adapter for local PostgreSQL, Neon adapter for serverless PostgreSQL
  const isLocalPostgres =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1")

  if (isLocalPostgres) {
    const pool = new pg.Pool({ connectionString })
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
