# Agent instructions

Primary reference for coding agents working in this repo.

- **Running dev / tests**: [DEVELOPMENT.md](./DEVELOPMENT.md)

For **architecture, env-by-situation, and deployment**, see [`packages/web/README.md`](./packages/web/README.md).

## What the user has to provide

The agent can handle everything else on its own, but cannot invent values for these — they have to come from the user:

- `DAYTONA_API_KEY` in `.env.local` (reused by `.env.test`).
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, or `GITHUB_PAT` as an alternative.
- Anything under `SMITHERY_*` or `GITHUB_APP_*`, if those integrations are in scope.

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).
