# Agent SDK Testing

This document describes how to run unit tests and integration tests for the Agent SDK.

---

## JSONL reference files

Raw JSONL output from each provider CLI is captured in `packages/agents/tests/fixtures/jsonl-reference/`. To regenerate:

```bash
npm run generate:jsonl-refs -w @upstream/agents
```

These fixtures are used by unit tests to verify JSONL parsing without requiring live API calls.

---

## Unit tests

Unit tests need no database and no env files.

Run the command below from the repo root.

```bash
npm run test -w @upstream/agents
```

---

## Agent SDK integration tests

Integration tests run each provider (Claude, Codex, Gemini, OpenCode, Pi) in real Daytona sandboxes. Tests are skipped when required API keys are not set.

Run the command below from the repo root.

```bash
DAYTONA_API_KEY=... ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
  npm test -w @upstream/agents -- tests/integration
```

### Using TEST_ prefixed API keys

You can use `TEST_` prefixed environment variables (e.g., `TEST_OPENAI_API_KEY`) to avoid conflicts with running agents. These take precedence over the non-prefixed versions.

Supported prefixed keys:
- `TEST_DAYTONA_API_KEY`
- `TEST_ANTHROPIC_API_KEY`
- `TEST_OPENAI_API_KEY`
- `TEST_GEMINI_API_KEY` / `TEST_GOOGLE_API_KEY`

Example:

```bash
TEST_DAYTONA_API_KEY=... TEST_ANTHROPIC_API_KEY=... \
  npm test -w @upstream/agents -- tests/integration
```
