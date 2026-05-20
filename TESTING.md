# Testing procedures

This document describes how to run Playwright end-to-end tests for the web application.

## Build check (no .env required)

To check for build errors without a real database:

```bash
DATABASE_URL="postgresql://x:x@localhost:5432/x" npm run build:web
```

Prisma only validates the URL format during generation—it doesn't connect.

The structure begins with the simplest setup and progresses to the more involved one.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

---

## Agent SDK tests

For unit tests and integration tests for the Agent SDK, see [packages/agents/TESTING.md](packages/agents/TESTING.md).

---

## Database setup

You need a Postgres database for Playwright below.

Set up a local database by running the commands below.

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
```

Example connection string for that local setup:

```text
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
```

When the schema changes, apply it by running the command below from `packages/web`:

```bash
DATABASE_URL="<same as the DATABASE_URL you configured>" npx prisma db push
```

---

## Playwright end-to-end tests

**Secrets:** In the **repo root** `.env`, you only need `DAYTONA_API_KEY` (`packages/web/playwright.config.ts` loads it).

**Note:** In a sandbox environment, take the `DAYTONA_API_KEY` from the shell environment variables.

**Database:** Use a database from [Database setup](#database-setup). Prefer a **separate** database from your dev DB so E2E does not overwrite local data. In `packages/web/.env.e2e`, set `DATABASE_URL`, `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY`.

**Build:** The web app depends on `background-agents`. Build it first from the repo root:

```bash
npm run build -w background-agents
```

Run the command below from `packages/web`.

```bash
npm run test:e2e
```
