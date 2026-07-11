import { config } from "dotenv";
import { execSync } from "node:child_process";

config();

// Migrations must run over a direct/session connection (port 5432), never the
// transaction pooler (6543). Prefer DIRECT_URL (Supabase/PDF convention), then
// POSTGRES_URL_NON_POOLING (Neon/Vercel integration), then DATABASE_URL.
const url =
  process.env.DIRECT_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL;

if (!url) {
  // No database URL available - skip migrations but still generate Prisma client
  // This allows builds to succeed in CI/CD without a real database
  console.log(
    "No DATABASE_URL set - skipping migrations, generating Prisma client with placeholder"
  );
  process.env.DATABASE_URL =
    "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  execSync("npx prisma generate", { stdio: "inherit" });
} else {
  if (url.includes(":6543")) {
    throw new Error(
      "Refusing to run migrations through the transaction pooler (port 6543). " +
        "`prisma migrate deploy` takes a session-level advisory lock that hangs " +
        "behind PgBouncer in transaction mode. Set POSTGRES_URL_NON_POOLING to the " +
        "direct/session connection (port 5432)."
    );
  }
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync("npx prisma generate", { stdio: "inherit" });
}