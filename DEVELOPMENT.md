# Development

How to run the web app locally and run its tests.

**Note:** PostgreSQL install commands below are for **Linux** (Debian/Ubuntu-style). Adapt for other OSes.

## Database setup

Dev and E2E use separate Postgres databases. Create both up front (or skip the test one if you won't run E2E):

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents_test OWNER sandboxed;"
```

Apply the dev schema:

```bash
npm run prisma:migrate
```

(E2E runs `prisma migrate reset --force` against its DB automatically.)

## Run the dev server

Put the env block from [Development](packages/web/README.md#development) in `.env.local` at the repo root — or `cp .env.example .env.local` and edit the placeholder values.

```bash
npm install
npm run dev
```

## Run E2E tests

Put the env block from [Testing](packages/web/README.md#testing) in `packages/web/.env.test`. Your `DAYTONA_API_KEY` from `.env.local` is reused.

From `packages/web/`:

```bash
npm run test:e2e
```

### Debug a failing E2E test

`dev:test` boots a dev server with the test env profile (test DB, `/api/test/auth` route enabled, placeholder OAuth) so you can manually reproduce a failure:

```bash
npm run dev:test
```

Then open http://localhost:4000.

## Agent SDK tests

See [packages/agents/TESTING.md](packages/agents/TESTING.md).
