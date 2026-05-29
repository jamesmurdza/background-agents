# Agent instructions

Primary reference for coding agents working in this repo.

- **Running dev / tests**: [DEVELOPMENT.md](./DEVELOPMENT.md)

For **architecture, env-by-situation, and deployment**, see [`packages/web/README.md`](./packages/web/README.md).

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).
