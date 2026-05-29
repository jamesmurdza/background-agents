# Agent instructions

Primary reference for coding agents working in this repo.

- **Tests** (unit tests, database for E2E, Playwright): [TESTING.md](./TESTING.md)
- **Development server** (`npm run dev`): [DEVELOPMENT.md](./DEVELOPMENT.md)

For **architecture, deployment, and production configuration**, see the root [README.md](./README.md).

## After editing code

Before running typecheck for the first time (or after pulling new changes), ensure dependencies are installed:

```bash
npm install
npm run prisma:generate
```

Then run `npm run typecheck` to verify there are no type errors. This is much faster than a full build (~5 seconds vs 2-3 minutes).
