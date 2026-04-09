# Agent SDK Testing

This document describes how to run unit tests and integration tests for the Agent SDK.

---

## JSONL reference files

Raw JSONL output from each provider CLI is captured in `packages/agents/tests/fixtures/jsonl-reference/`. To regenerate:

```bash
npm run generate:jsonl-refs -w @upstream/agents
```

These fixtures are used as samples to verify that the agents are working and to analyze their output formats.

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
npm test -w @upstream/agents -- tests/integration
```

### Using TEST_ prefixed API keys

The tests use `TEST_` prefixed environment variables (e.g., `TEST_OPENAI_API_KEY`) to avoid conflicts with running agents. These take precedence over the non-prefixed versions.

Supported prefixed keys:
- `TEST_DAYTONA_API_KEY`
- `TEST_ANTHROPIC_API_KEY`
- `TEST_OPENAI_API_KEY`
- `TEST_GEMINI_API_KEY` / `TEST_GOOGLE_API_KEY`

### Debugging

Set `CODING_AGENTS_DEBUG=1` to enable verbose debug output during test runs. This will print additional logging information useful for troubleshooting agent behavior.
