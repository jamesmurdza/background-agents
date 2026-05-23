# JSONL Reference Files

Raw JSONL output captured from actual AI coding agent CLI runs. These are **not normalized** - they show the native output format of each provider exactly as the CLI produces it.

## Files

| File | Provider | Description |
|------|----------|-------------|
| `claude.jsonl` | Claude Code | Anthropic Claude Code CLI |
| `codex.jsonl` | Codex | OpenAI Codex CLI |
| `copilot-gpt-4.1.jsonl` | GitHub Copilot | Copilot CLI with gpt-4.1 (paid tier) — emits `assistant.message` with full content |
| `copilot-gpt-5-mini.jsonl` | GitHub Copilot | Copilot CLI with gpt-5-mini (free tier) — emits only `assistant.message_delta` (all `ephemeral: true`), no `assistant.message` |
| `eliza.jsonl` | Eliza | Built-in deterministic test agent |
| `gemini.jsonl` | Gemini | Google Gemini CLI |
| `goose.jsonl` | Goose | Block's Goose AI coding agent CLI |
| `opencode.jsonl` | OpenCode | OpenCode CLI |
| `pi.jsonl` | Pi | Pi Coding Agent CLI |

## Regenerating

From the repo root:

```bash
npm run generate:jsonl-refs -w background-agents
```

Requires `DAYTONA_API_KEY` and provider-specific API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`).

**Note:** The Eliza agent is deterministic and does not require an API key.
