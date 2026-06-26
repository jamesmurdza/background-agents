import { describe, it, expect, vi } from "vitest"
import { persistAgentSnapshot, type SnapshotPersistClient } from "./persist-snapshot"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import type { AgentSnapshot } from "@/lib/agent-session"

const NUL = String.fromCharCode(0)

function completedSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    status: "completed",
    content: "all done",
    toolCalls: [],
    contentBlocks: [],
    sessionId: "sess-1",
    ...overrides,
  }
}

function makeClient() {
  const message = { update: vi.fn().mockResolvedValue({}) }
  const chat = { update: vi.fn().mockResolvedValue({}) }
  return { client: { message, chat } as SnapshotPersistClient, message, chat }
}

describe("persistAgentSnapshot", () => {
  it("releases the chat from running even when the message write fails", async () => {
    // Reproduces the stuck-"running" bug: Postgres rejects a NUL byte that
    // slips through, message.update throws — the chat status reset must NOT be
    // skipped, or the chat is stranded as permanently "Chat is busy".
    const { client, message, chat } = makeClient()
    message.update.mockRejectedValueOnce(new Error("invalid byte sequence 0x00"))

    const result = await persistAgentSnapshot({
      prisma: client,
      chatId: "chat-1",
      assistantMessageId: "msg-1",
      snapshot: completedSnapshot(),
      isFinal: true,
    })

    expect(result.statusReset).toBe(true)
    expect(chat.update).toHaveBeenCalledTimes(1)
    expect(chat.update.mock.calls[0][0]).toMatchObject({
      where: { id: "chat-1" },
      data: { status: "ready", backgroundSessionId: null },
    })
  })

  it("maps an errored turn to status error and clears the background session", async () => {
    const { client, chat } = makeClient()

    await persistAgentSnapshot({
      prisma: client,
      chatId: "chat-1",
      assistantMessageId: "msg-1",
      snapshot: completedSnapshot({ status: "error" }),
      isFinal: true,
    })

    expect(chat.update.mock.calls[0][0].data).toMatchObject({
      status: "error",
      backgroundSessionId: null,
    })
  })

  it("does not touch chat status on a non-final (periodic) persist", async () => {
    const { client, message, chat } = makeClient()

    await persistAgentSnapshot({
      prisma: client,
      chatId: "chat-1",
      assistantMessageId: "msg-1",
      snapshot: completedSnapshot({ status: "running" }),
      isFinal: false,
    })

    expect(message.update).toHaveBeenCalledTimes(1)
    expect(chat.update).not.toHaveBeenCalled()
  })

  it("strips NUL bytes from content before writing", async () => {
    const { client, message } = makeClient()

    await persistAgentSnapshot({
      prisma: client,
      chatId: "chat-1",
      assistantMessageId: "msg-1",
      snapshot: completedSnapshot({ content: `hello${NUL}world` }),
      isFinal: true,
    })

    expect(message.update.mock.calls[0][0].data.content).toBe("helloworld")
  })
})

describe("pg-sanitize", () => {
  it("removes NUL characters from strings", () => {
    expect(stripNullBytes(`a${NUL}b${NUL}c`)).toBe("abc")
    expect(stripNullBytes("clean")).toBe("clean")
  })

  it("deep-cleans NUL bytes in nested JSON without mutating the input", () => {
    const input = { tool: `gr${NUL}ep`, args: [`x${NUL}`, { k: `v${NUL}` }], n: 3 }
    const cleaned = stripNullBytesDeep(input)
    expect(cleaned).toEqual({ tool: "grep", args: ["x", { k: "v" }], n: 3 })
    // original untouched
    expect(input.tool).toBe(`gr${NUL}ep`)
  })
})
