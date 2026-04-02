# Testing procedures

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

---

## Unit tests

Unit tests need no database and no env files.

Run the command below from the repo root.

```bash
npm run test -w @upstream/agents
```

---

## Database

You need a Postgres database for Playwright and for the development server below.

Set up a local database by running the commands below.

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
```

Example connection strings for that local setup:

```text
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
DATABASE_URL_UNPOOLED="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
```

When the schema changes, apply it by running the command below from `packages/web`:

```bash
DATABASE_URL="<same as the DATABASE_URL you configured>" npx prisma db push
```

---

## Playwright end-to-end tests

**Secrets:** In the **repo root** `.env`, you only need `DAYTONA_API_KEY` (`packages/web/playwright.config.ts` loads it).

**Note:** In a sandbox environment, take the DAYTONA_API_KEY from the shell environment variables.

**Database:** Use the database from [Database](#database). In `packages/web/.env.e2e`, set `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (same value is fine), `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY`.

Run the command below from `packages/web`.

```bash
npm run test:e2e
```

---

## Development server

**Secrets:** In `packages/web/.env`, set **`GITHUB_PAT`** and **`DAYTONA_API_KEY`**. You also need DB URLs, `NEXTAUTH_*`, `ENCRYPTION_KEY`, and the rest of the template in the root **README** → *Development*.

**Note:** In a sandbox environment, take the DAYTONA_API_KEY and GITHUB_PAT from the shell environment variables.

**Database:** Use the database from [Database](#database); `DATABASE_URL` / `DATABASE_URL_UNPOOLED` go in the same `packages/web/.env`.

With `GITHUB_PAT` set you get auto-login at http://localhost:3000—no GitHub OAuth app required. The first visit creates a dev user in the database and logs a warning that dev mode is active.

Run the command below from the repo root.

```bash
npm run dev
```

If the app is served behind a Daytona proxy, `NEXTAUTH_URL` must match the public URL (not plain `http://localhost:3000`); see README *Development* for the full env template.
