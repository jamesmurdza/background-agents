# Development server

This document describes how to run the web app locally with `npm run dev`.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

---

## Database setup

You need a Postgres database for the development server below.

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

Apply the schema (from the repo root — uses the env cascade so the URL is read from `.env.local`):

```bash
npm run prisma:migrate
```

---

## Run the development server

Prerequisites: Node.js 18+ and the Postgres database from [Database setup](#database-setup).

**Secrets:** You need a GitHub [Personal Access Token](https://github.com/settings/tokens) with scopes `repo` and `read:user` (`GITHUB_PAT`), and a [Daytona](https://www.daytona.io/) API key (`DAYTONA_API_KEY`).

**Note:** In a sandbox environment, take `DAYTONA_API_KEY` and `GITHUB_PAT` from the shell environment variables.

**Database:** Put `DATABASE_URL` in `.env.local` at the repo root (same value as in [Database setup](#database-setup), or your provider's URL). All root npm scripts read it via the env cascade.

**Minimal `.env.local` (at repo root):** Fill in the database URL, then set the rest. With `GITHUB_PAT` set, GitHub OAuth placeholders are not used; they can stay as shown.

```bash
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"

# Local dev: http://localhost:4000. Behind Daytona proxy: https://4000-{sandbox-id}.daytonaproxy01.net
NEXTAUTH_URL="http://localhost:4000"
NEXTAUTH_SECRET="dev-secret-not-used-in-dev-mode"

GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"

ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"

GITHUB_PAT=ghp_your_token_here
DAYTONA_API_KEY=dtn_your_key_here
```

If the app is served behind a Daytona proxy, `NEXTAUTH_URL` must be that public URL (not `http://localhost:4000`). NextAuth validates requests against this value.

With `GITHUB_PAT` set you get auto-login at http://localhost:4000—no GitHub OAuth app required. The first visit creates a dev user in the database and logs a warning that dev mode is active.

The first time you work in the repo, from the repo root run `npm install` and `npm run build:sdk`, then apply the schema ([Database setup](#database-setup)) if you have not already.

Run the command below from the repo root.

```bash
npm run dev
```
