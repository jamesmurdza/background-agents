# Agent instructions

Primary reference for coding agents working in this repo.

- **Running dev / tests**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Repo overview / packages**: [README.md](./README.md)

## What the user has to provide

The agent can follow the setup and workflow instructions in this repo on its own. The user provides values for these env vars by exporting them in the current shell environment.

**Required for dev server and tests**

- `DAYTONA_API_KEY` — exported in the shell (reused by `.env.test`).

**Required for dev server**

- Auth: either `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`, or `GITHUB_PAT` as an alternative.

**Optional** (only if those integrations are in scope)

- `SMITHERY_*` — remote MCP servers from the Smithery registry.
- `GITHUB_APP_*` — authenticated GitHub MCP server.

## Running tests

Before running E2E tests, check that the user has exported the required env vars in the current shell:

- `DAYTONA_API_KEY` — required (reused by `.env.test`).

If it is not set, stop and ask the user to export it before continuing.

Once the env var is present, run the tests from `packages/web/`:

```bash
npm run test:e2e
```

For full setup (test DB, `packages/web/.env.test`, debug workflow), see [DEVELOPMENT.md](./DEVELOPMENT.md#run-e2e-tests).

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).

Editing `prisma/schema.prisma`? See [Database migration](./packages/web/README.md#database-migration).

## Debugging

- Investigate with console logs.
- Prefer integration and end-to-end tests over narrow unit tests.
- Write a test that reproduces the bug before fixing it.
- After fixing, keep only the general-case tests — drop the one written to pin down this specific bug.
