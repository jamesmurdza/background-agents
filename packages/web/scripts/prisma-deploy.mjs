import { config } from "dotenv";
import { execSync } from "node:child_process";

config();

const url =
  process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

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
  process.env.DATABASE_URL = url;
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync("npx prisma generate", { stdio: "inherit" });
}