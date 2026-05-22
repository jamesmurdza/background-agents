# JSONL Reference Files

Raw JSONL output captured from actual AI coding agent CLI runs. These are **not normalized** - they show the native output format of each provider exactly as the CLI produces it.

## Files

| File | Provider | Description |
|------|----------|-------------|
| `claude.jsonl` | Claude Code | Anthropic Claude Code CLI |
| `codex.jsonl` | Codex | OpenAI Codex CLI |
| `eliza.jsonl` | Eliza | Built-in deterministic test agent |
| `gemini.jsonl` | Gemini | Google Gemini CLI |
| `opencode.jsonl` | OpenCode | OpenCode CLI |
| `pi.jsonl` | Pi | Pi Coding Agent CLI |

## Regenerating

From the repo root:

```bash
npm run generate:jsonl-refs -w background-agents
```

Requires `DAYTONA_API_KEY` and provider-specific API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`).

**Note:** The Eliza agent is deterministic and does not require an API key.
