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
| `gemini-error.jsonl` | Gemini | Gemini CLI failing a run — a Pro model on a free key / out of quota (429 `TerminalQuotaError`). The real reason is a **plain-text** JS error dump on stdout; the trailing `result` has `status: "error"` but only a generic `{ type: "unknown", message: "[API Error: …]" }` |
| `goose.jsonl` | Goose | Block's Goose AI coding agent CLI |
| `kilo.jsonl` | Kilo | Kilo CLI — OpenCode fork with its own gateway |
| `kimi.jsonl` | Kimi Code | Moonshot Kimi Code CLI — chat-completion-shaped stream-json |
| `kimi-error.jsonl` | Kimi Code | Kimi's plain-text fatal-error output (out-of-credits / 429 insufficient balance) |
| `opencode.jsonl` | OpenCode | OpenCode CLI |
| `opencode-usage-limit.jsonl` | OpenCode | OpenCode CLI hitting a monthly usage limit — `ERROR`-level log lines, no JSON event stream |
| `opencode-usage-limit-logfmt.jsonl` | OpenCode | Same usage-limit failure in OpenCode's logfmt log format |
| `pi.jsonl` | Pi | Pi Coding Agent CLI |

## Regenerating

From the repo root:

```bash
npm run generate:jsonl-refs -w @background-agents/sdk
```

Requires `DAYTONA_API_KEY` and provider-specific API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`).

**Note:** The Eliza agent is deterministic and does not require an API key.

### Capturing a failure fixture (e.g. `gemini-error.jsonl`)

`gemini-error.jsonl` is the `error` event + failing `result` Gemini emits when a
Pro model is requested on a free-tier key. To re-capture it for real, run the
Pro model with a **free-tier** `GEMINI_API_KEY` and override the model + output
name:

```bash
GEMINI_MODEL=gemini-2.5-pro JSONL_OUTPUT_NAME=gemini-error \
  npm run generate:jsonl-refs -w @background-agents/sdk -- gemini
```
