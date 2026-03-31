# Quick reference

Minimal steps to work in this repo. Full docs: root **README**.

- **Install:** `npm install && npm run build:sdk`
- **DB (local):** `cd packages/web && npx prisma db push` — configure `packages/web/.env` first (see README).
- **Dev server:** `npm run dev` — app at http://localhost:3000 (needs `GITHUB_PAT` + `DAYTONA_API_KEY` in `packages/web/.env` for typical local use).
- **SDK tests:** `npm run test -w @upstream/agents`
- **Web E2E:** `cd packages/web && npm run test:e2e` — env: `packages/web/.env.e2e` + `DAYTONA_API_KEY`; details in README (*End-to-end tests*).

Daytona sandbox workspace (AGENTS.md): Postgres install, `.env` with proxy `NEXTAUTH_URL`, `nohup npm run dev`, etc.
