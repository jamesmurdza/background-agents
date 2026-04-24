import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadEnv } from "dotenv"
import { defineConfig } from "prisma/config"

const configDir = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(configDir, ".env") })

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL || "",
  },
})
