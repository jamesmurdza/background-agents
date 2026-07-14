# JSONL Reference Files

Raw JSONL output captured from actual AI coding agent CLI runs. These are **not normalized** - they show the native output format of each provider exactly as the CLI produces it.

## Files

| File | Provider | Description |
|------|----------|-------------|
| `claude.jsonl` | Claude Code | Anthropic Claude Code CLI |
| `claude-error.jsonl` | Claude Code | No-credit failure — the `result` keeps `subtype: "success"` but sets `is_error: true` with `result: "Credit balance is too low"` (the parser must honor `is_error`, not just `subtype`) |
| `codex.jsonl` | Codex | OpenAI Codex CLI |
| `codex-error.jsonl` | Codex | No-credit failure — `{type:"error"}` + `turn.failed` with `"Quota exceeded. Check your plan and billing details."` |
| `copilot-gpt-4.1.jsonl` | GitHub Copilot | Copilot CLI with gpt-4.1 (paid tier) — emits `assistant.message` with full content |
| `copilot-gpt-5-mini.jsonl` | GitHub Copilot | Copilot CLI with gpt-5-mini (free tier) — emits only `assistant.message_delta` (all `ephemeral: true`), no `assistant.message` |
| `droid.jsonl` | Factory Droid | `droid exec` BYOK on Anthropic (`-m custom:byok-0`) — droid-native stream-json (system/init, message, reasoning, tool_call, tool_result, completion) |
| `droid-gemini.jsonl` | Factory Droid | `droid exec` BYOK on Gemini via its OpenAI-compatible endpoint (generic-chat-completion-api) — same droid-native shape |
| `droid-error.jsonl` | Factory Droid | droid's `{type:"error"}` fatal event (e.g. invalid API key / 401 auth failure) |
| `eliza.jsonl` | Eliza | Built-in deterministic test agent |
| `gemini.jsonl` | Gemini | Google Gemini CLI |
| `gemini-error.jsonl` | Gemini | Gemini CLI failing a run — a Pro model on a free key / out of quota (429 `TerminalQuotaError`). The real reason is a **plain-text** JS error dump on stdout; the trailing `result` has `status: "error"` but only a generic `{ type: "unknown", message: "[API Error: …]" }` |
| `goose.jsonl` | Goose | Block's Goose AI coding agent CLI |
| `goose-error.jsonl` | Goose | No-credit failure — Goose wraps it in an assistant message (`"Ran into this error: … credit balance is too low …"`) then a plain `complete`; there is no `{type:"error"}` event |
| `kilo.jsonl` | Kilo | Kilo CLI — OpenCode fork with its own gateway |
| `kilo-error.jsonl` | Kilo | No-credit failure — `{type:"error"}` with an `APIError` (`statusCode: 400`, credit-too-low) from Anthropic via the Kilo/OpenCode gateway |
| `kimi.jsonl` | Kimi Code | Moonshot Kimi Code CLI — chat-completion-shaped stream-json |
| `kimi-error.jsonl` | Kimi Code | Kimi's plain-text fatal-error output (out-of-credits / 429 insufficient balance) |
| `opencode.jsonl` | OpenCode | OpenCode CLI |
| `opencode-usage-limit.jsonl` | OpenCode | OpenCode CLI hitting a monthly usage limit — `ERROR`-level log lines, no JSON event stream |
| `opencode-usage-limit-logfmt.jsonl` | OpenCode | Same usage-limit failure in OpenCode's logfmt log format |
| `pi.jsonl` | Pi | Pi Coding Agent CLI |
| `pi-gemini.jsonl` | Pi | Pi on `google/gemini-2.5-flash` — a successful run (text + tool calls) |
| `pi-anthropic-error.jsonl` | Pi | No-credit failure on Anthropic — error rides on the assistant message's `stopReason: "error"` + `errorMessage` (message_end/turn_end/agent_end), not a `{type:"error"}` event |
| `pi-openai-error.jsonl` | Pi | No-credit failure on OpenAI — same `stopReason: "error"` shape; message is bare plain text (`"You exceeded your current quota…"`) |
| `pi-gemini-error.jsonl` | Pi | Free-tier quota failure on `google/gemini-2.5-pro` — `stopReason: "error"` 429 `RESOURCE_EXHAUSTED`, with Pi's `auto_retry_start` cycles |

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
