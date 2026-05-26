# Testing procedures

This document describes how to run tests for the web application and agent SDK.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

## Build check (no .env required)

To check for build errors without a real database:

```bash
npm run build:web
```

## Agent SDK tests

For unit tests and integration tests for the Agent SDK, see [packages/agents/TESTING.md](packages/agents/TESTING.md).

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

## Playwright end-to-end tests

**Secrets:** Copy `packages/web/.env.test.example` to `packages/web/.env.test` and fill in `DATABASE_URL` (a **test** database) and `DAYTONA_API_KEY`. The template already sets `ENABLE_TEST_AUTH="true"` (required) and placeholder `NEXTAUTH_*`/`GITHUB_*` values. `packages/web/playwright.config.ts` loads `.env.test` first, then falls back to the repo-root `.env`.

**Note:** In a sandbox environment, take the `DAYTONA_API_KEY` from the shell environment variables.

**Database:** Use a **separate** database from your dev DB so E2E does not overwrite local data. The `DATABASE_URL` must contain `test`, `localhost`, or `127.0.0.1` (a safety check), or set `I_KNOW_THIS_IS_THE_TEST_DB=true` to bypass it. You do not need to apply the schema by hand—global setup runs `npx prisma migrate reset --force` before the suite.

**Build:** The web app depends on `background-agents`. Build it first from the repo root:

```bash
npm run build -w background-agents
```

Run the command below from `packages/web`.

```bash
npm run test:e2e
```
