# Development server

How to run the web app locally with `npm run dev`.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

---

## Database setup

You need a Postgres database for the development server.

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
```

Apply the schema (from the repo root — uses the env cascade so the URL is read from `.env.local`):

```bash
npm run prisma:migrate
```

---

## Run the development server

**Prerequisites:** Node.js 18+, the Postgres database from [Database setup](#database-setup), a GitHub [Personal Access Token](https://github.com/settings/tokens) with scopes `repo` and `read:user`, and a [Daytona](https://www.daytona.io/) API key.

**Note:** In a sandbox environment, take `DAYTONA_API_KEY` and `GITHUB_PAT` from the shell environment variables.

**Env:** Put the **Development** env block from [`packages/web/README.md`](packages/web/README.md#development) in `.env.local` at the repo root. The root npm scripts load it via the env cascade.

With `GITHUB_PAT` set you get auto-login at http://localhost:4000 — no GitHub OAuth app required. The first visit creates a dev user in the database and logs a warning that dev mode is active.

If the app is served behind a Daytona proxy, `NEXTAUTH_URL` must be that public URL (not `http://localhost:4000`). NextAuth validates requests against this value.

**First time:** From the repo root, run `npm install` and `npm run build:sdk`, then apply the schema ([Database setup](#database-setup)) if you haven't already.

Run the dev server from the repo root:

```bash
npm run dev
```
