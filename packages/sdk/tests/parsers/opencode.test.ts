/**
 * Parser tests for parseOpencodeLine - pure data transformations from the agent's
 * event format to our standard Event format. No mocks, no I/O.
 */
import { describe, it, expect } from "vitest"
import { parseOpencodeLine, OPENCODE_TOOL_MAPPINGS } from "../../src/agents/index.js"
import { createContext } from "./helpers.js"

describe("parseOpencodeLine", () => {
  const mappings = OPENCODE_TOOL_MAPPINGS

  it("returns null for invalid JSON", () => {
    const ctx = createContext()
    expect(parseOpencodeLine("not json", mappings, ctx)).toBeNull()
    expect(parseOpencodeLine("", mappings, ctx)).toBeNull()
  })

  it("parses step_start event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "step_start", "sessionID": "ses_xyz123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "session", id: "ses_xyz123" })
  })

  it("parses text event with content", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text", "text": "Processing..."}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "token", text: "Processing..." })
  })

  it("returns null for text event without text type", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "image"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("returns null for text event without text content", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "text", "sessionID": "ses_xyz123", "part": {"type": "text"}}',
      mappings,
      ctx
    )
    expect(event).toBeNull()
  })

  it("parses tool_call event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call", "tool": "write_file"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "write_file", input: {} })
  })

  it("handles tool_call with missing tool name", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_call", "sessionID": "ses_xyz123", "part": {"type": "tool-call"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_start", name: "unknown", input: {} })
  })

  it("parses tool_result event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "tool_result", "sessionID": "ses_xyz123"}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "tool_end" })
  })

  it("parses step_finish event", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "step_finish", "sessionID": "ses_xyz123", "part": {"reason": "stop"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end" })
  })

  it("parses error event with error message", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError", "data": {"message": "Rate limit exceeded"}}}',
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error: "Rate limit exceeded — wait a moment and retry",
    })
  })

  it("parses error event falling back to error name", () => {
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"name": "APIError"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({ type: "end", error: "APIError" })
  })

  it("surfaces the raw payload (not 'Unknown error') when the error has no message or name", () => {
    // Regression: an OpenCode error event whose payload has neither
    // error.data.message nor error.name used to collapse to the useless string
    // "Unknown error". Now the raw fields survive — here a 402 status, which is
    // additionally classified as a balance problem.
    const ctx = createContext()
    const event = parseOpencodeLine(
      '{"type": "error", "sessionID": "ses_xyz123", "error": {"statusCode": 402, "providerID": "opencode"}}',
      mappings,
      ctx
    )
    expect(event).toEqual({
      type: "end",
      error:
        '{"statusCode":402,"providerID":"opencode"} — switch to a free model or add credits / an API key',
    })
  })

  it("returns null for unknown event types", () => {
    const ctx = createContext()
    expect(parseOpencodeLine('{"type": "unknown"}', mappings, ctx)).toBeNull()
  })

  it("retains a terminal model lookup failure instead of the following generic JSON error", () => {
    const ctx = createContext()
    const log = 'timestamp=2026-10-05T08:25:21.833Z level=ERROR message=failed ref=err_test error="ProviderModelNotFoundError: Model not found: opencode/retired-free. Did you mean: another-free?" cause="private stack"'
    expect(parseOpencodeLine(log, mappings, ctx)).toEqual({ type: "end", error: "Model not found: opencode/retired-free — select a different model for this agent" })
    expect(parseOpencodeLine('{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}', mappings, ctx)).toBeNull()
  })

  it("does not treat a subscriber's model lookup error as a terminal turn failure", () => {
    expect(parseOpencodeLine('timestamp=now level=ERROR message="share subscriber failed" cause="ProviderModelNotFoundError: Model not found: opencode/retired-free"', mappings, createContext())).toBeNull()
  })

  it("ignores plaintext logs that are not model-call errors", () => {
    const ctx = createContext()
    expect(parseOpencodeLine("INFO 2026-04-03 service=models.dev refreshing", mappings, ctx)).toBeNull()
    // A tool/bash ERROR must not end the turn — the agent can recover from it.
    expect(parseOpencodeLine("ERROR 2026-04-03 service=bash command failed", mappings, ctx)).toBeNull()
  })

  it("surfaces a repeated service=llm error log as a terminal end (retryable hang)", () => {
    // On a retryable model error OpenCode emits no JSON event — it retries with
    // unbounded backoff, logging only this plaintext line each attempt. Without
    // this the turn hangs forever on the generating spinner.
    const ctx = createContext()
    const llmError =
      'ERROR 2026-04-03T21:08:42 +1717ms service=llm providerID=anthropic modelID=claude-haiku-4-5 ' +
      'session.id=ses_x error={"error":{"name":"AI_APICallError",' +
      '"requestBodyValues":{"system":[{"type":"text","text":"prompt"}]},"statusCode":429,"isRetryable":true}}'

    // First failure: grace — give OpenCode one retry to recover.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toBeNull()
    // Second failure: it's stuck — surface the classified error and end the turn.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toEqual({
      type: "end",
      error: "AI_APICallError HTTP 429 — wait a moment and retry",
    })
    // Subsequent failures are not re-emitted.
    expect(parseOpencodeLine(llmError, mappings, ctx)).toBeNull()
  })

  it("surfaces a service=session.processor error immediately with its message", () => {
    // The terminal, turn-level failure line. Highest signal — carries a
    // human-readable message and means the turn gave up. No grace: waiting for a
    // second line is what made the UI appear to hang.
    const ctx = createContext()
    const processorError =
      "ERROR 2026-06-20T15:51:44 +2ms service=session.processor " +
      "error=Monthly usage limit reached. Resets in 10 days. To continue using this model now, " +
      "enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go " +
      'stack="AI ...'
    expect(parseOpencodeLine(processorError, mappings, ctx)).toEqual({
      type: "end",
      error:
        "Monthly usage limit reached. Resets in 10 days. To continue using this model now, " +
        "enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go",
    })
    // Already terminated — later error lines are not re-emitted.
    expect(parseOpencodeLine(processorError, mappings, ctx)).toBeNull()
  })

  it("surfaces a logfmt 'stream error' for the main agent (agent=build) immediately", () => {
    // Production opencode writes structured logfmt — NOT the pretty `ERROR …`
    // format. The main model call fails once then hangs indefinitely, so we must
    // surface on the first agent=build line (there is no second one to wait for).
    const ctx = createContext()
    const buildError =
      'timestamp=2026-06-20T16:38:24.349Z level=ERROR run=3b5d38d5 message="stream error" ' +
      "providerID=opencode-go modelID=mimo-v2.5-pro session.id=ses_x small=false agent=build mode=primary " +
      'error.error="AI_APICallError: Monthly usage limit reached. Resets in 10 days. ' +
      'To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go"'
    expect(parseOpencodeLine(buildError, mappings, ctx)).toEqual({
      type: "end",
      error:
        "Monthly usage limit reached. Resets in 10 days. " +
        "To continue using this model now, enable usage from your available balance: https://opencode.ai/workspace/wrk_x/go",
    })
  })

  it("ignores a logfmt 'stream error' from the title sidecar (agent=title/small=true)", () => {
    const ctx = createContext()
    const titleError =
      'timestamp=2026-06-20T16:38:30.455Z level=ERROR message="stream error" ' +
      "providerID=opencode-go modelID=mimo-v2.5-pro small=true agent=title mode=primary " +
      'error.error="AI_RetryError: Failed after 3 attempts. Last error: Monthly usage limit reached."'
    expect(parseOpencodeLine(titleError, mappings, ctx)).toBeNull()
  })

  it("ignores the title/summary sidecar's billing failure (false positive)", () => {
    // Title generation is a separate cheap-model call; on a Go-only key it 401s
    // with a CreditsError. That must NOT end the turn — the main model is fine.
    const ctx = createContext()
    const titleLlmError =
      "ERROR 2026-06-20T15:39:20 +1ms service=llm providerID=opencode modelID=big-pickle " +
      'error={"error":{"name":"AI_APICallError","requestBodyValues":{"model":"gpt-5-nano",' +
      '"input":[{"role":"developer","content":"You are a title generator. Output ONLY a title."}]},' +
      '"statusCode":401}}'
    // Even repeated, title-sidecar llm errors are skipped (never counted).
    expect(parseOpencodeLine(titleLlmError, mappings, ctx)).toBeNull()
    expect(parseOpencodeLine(titleLlmError, mappings, ctx)).toBeNull()
    // A session.prompt "failed to generate title" line is also ignored.
    expect(
      parseOpencodeLine(
        "ERROR 2026-06-20 service=session.prompt error=No output generated. failed to generate title",
        mappings,
        ctx
      )
    ).toBeNull()
  })
})
