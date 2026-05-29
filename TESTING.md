# Testing

## Build check (no DB)

To verify the web app builds without setting up a database:

```bash
npm run build:web
```

## Agent SDK tests

For unit and integration tests of the Agent SDK, see [packages/agents/TESTING.md](packages/agents/TESTING.md).

## E2E tests (Playwright)

### One-time setup

**Build the SDK** (required after install or after pulling SDK changes):

```bash
npm run build:sdk
```

**Create a local Postgres test database.** Commands below are for Linux (Debian/Ubuntu); adapt for your OS:

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents_test OWNER sandboxed;"
```

**Set up env files** — two files, two values:

1. Root `.env.local` (shared dev secrets — cascades into all npm scripts):

   ```
   DAYTONA_API_KEY=<your real Daytona key>
   ```

2. `packages/web/.env.test` (test-mode overrides) — copy the template:

   ```bash
   cp packages/web/.env.test.example packages/web/.env.test
   ```

   Edit `DATABASE_URL` to point at your test DB. The URL **must** contain `test`, `localhost`, or `127.0.0.1`, or you must set `I_KNOW_THIS_IS_THE_TEST_DB=true`. This guards against accidents — every test run wipes the database with `prisma migrate reset --force`.

   Everything else in the example (test NextAuth secret, placeholder OAuth, `ENABLE_TEST_AUTH=true`) can stay at its default value.

### Run

From `packages/web/`:

```bash
npm run test:e2e
```

### Debug a failing test

`dev:test` boots a dev server with the same env profile as Playwright — test DB, `/api/test/auth` route enabled, placeholder OAuth — so you can manually reproduce a failure:

```bash
npm run dev:test
```

Then open `http://localhost:4000` and poke around.
