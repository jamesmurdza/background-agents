import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadEnv } from "dotenv"
import { defineConfig } from "prisma/config"

const configDir = path.dirname(fileURLToPath(import.meta.url))
// Mirror Next.js convention: .env.local overrides .env. Both are optional.
loadEnv({ path: path.join(configDir, ".env") })
loadEnv({ path: path.join(configDir, ".env.local"), override: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prefer the direct (non-pooling) connection for CLI/migrations — the
    // pgbouncer pooler can't take the advisory locks migrate needs. The runtime
    // app is unaffected (it connects via DATABASE_URL through its own client).
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
})
