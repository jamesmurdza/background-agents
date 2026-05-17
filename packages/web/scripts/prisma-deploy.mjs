import { config } from "dotenv";
import { execSync } from "node:child_process";

config();

const url =
  process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

if (!url) {
  throw new Error("No database URL available");
}

process.env.DATABASE_URL = url;

execSync("npx prisma migrate deploy", { stdio: "inherit" });
execSync("npx prisma generate", { stdio: "inherit" });