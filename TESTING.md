# Testing

## Agent SDK tests

See [packages/agents/TESTING.md](packages/agents/TESTING.md).

## E2E tests (Playwright)

### One-time setup

Set up Postgres as in [DEVELOPMENT.md](DEVELOPMENT.md#database-setup), but name the database `sandboxed_agents_test` instead of `sandboxed_agents`.

Put the **Testing** env block from [`packages/web/README.md`](packages/web/README.md#testing-e2e) in `packages/web/.env.test`. Your `DAYTONA_API_KEY` from `.env.local` is reused.

### Run

From `packages/web/`:

```bash
npm run test:e2e
```

### Debug a failing test

`dev:test` boots a dev server with the test env profile (test DB, `/api/test/auth` route enabled, placeholder OAuth) so you can manually reproduce a failure:

```bash
npm run dev:test
```

Then open http://localhost:4000.
