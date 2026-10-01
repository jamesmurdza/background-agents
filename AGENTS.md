# Agent instructions

Primary reference for coding agents working in this repo.

- **Repo overview / packages**: [README.md](./README.md)

## What the user has to provide

The agent can follow the setup and workflow instructions in this repo on its own. The user provides values for these env vars by exporting them in the current shell environment.

> **Note for agents:** check whether these env vars are set by running the `env` command (e.g. `env | grep DAYTONA_API_KEY`). Do not assume they are unset — they are exported in the shell, not stored in a tracked file.

**Required for dev server and tests**

- `DAYTONA_API_KEY` — exported in the shell (reused by `.env.test`).

**Required for dev server**

- Auth: `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` (GitHub OAuth app).

**Optional** (only if those integrations are in scope)

- `SMITHERY_*` — remote MCP servers from the Smithery registry.
- `GITHUB_APP_*` — authenticated GitHub MCP server.

Before running tests or a dev server, confirm the required env vars above are exported, then follow [DEVELOPMENT.md](./DEVELOPMENT.md).

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

## Interactive prompt ordering

- Existing ready chats send ordinary text through the server queue, even when the agent looks idle. First sends, attachments, and plan-mode sends still use the direct route.
- Preserve the order of enqueues from one browser tab and keep unsynced prompts locally until the server confirms them. A busy rejection on the direct route must return the unsent text to the composer.
- When changing these paths, test delayed and failed enqueues, concurrent tabs, and persistence after refresh.
