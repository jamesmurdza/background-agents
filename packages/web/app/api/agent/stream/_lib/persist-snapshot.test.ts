import { describe, it, expect, vi } from "vitest"
import { persistAgentSnapshot, type SnapshotPersistClient } from "./persist-snapshot"
import { stripNullBytes, stripNullBytesDeep } from "@/lib/db/pg-sanitize"
import type { AgentSnapshot } from "@/lib/agent-session"

const NUL = String.fromCharCode(0)
const turn = { chatId: "chat-1", backgroundSessionId: "run-1", assistantMessageId: "message-1" }

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { status: "running", content: "answer", toolCalls: [], contentBlocks: [], sessionId: "sess-1", ...overrides }
}

function makeClient(owned = true) {
  const message = { update: vi.fn().mockResolvedValue({}) }
  const chat = { updateMany: vi.fn().mockResolvedValue({ count: owned ? 1 : 0 }) }
  const client = {
    chat,
    message,
    $transaction: async <T>(fn: (tx: { chat: typeof chat; message: typeof message }) => Promise<T>) => fn({ chat, message }),
  } as SnapshotPersistClient
  return { client, message, chat }
}

describe("persistAgentSnapshot", () => {
  it("writes only while the same turn remains active", async () => {
    const { client, message, chat } = makeClient()
    expect((await persistAgentSnapshot({ prisma: client, turn, snapshot: snapshot() })).persisted).toBe(true)
    expect(chat.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        backgroundSessionId: turn.backgroundSessionId,
        activeAssistantMessageId: turn.assistantMessageId,
        finalizationClaimId: null,
      }),
    }))
    expect(message.update).toHaveBeenCalledTimes(1)
  })

  it("discards a stale stream snapshot without touching its message", async () => {
    const { client, message } = makeClient(false)
    expect((await persistAgentSnapshot({ prisma: client, turn, snapshot: snapshot() })).persisted).toBe(false)
    expect(message.update).not.toHaveBeenCalled()
  })

  it("requires the finalization owner for a final snapshot", async () => {
    const { client, chat } = makeClient()
    await persistAgentSnapshot({ prisma: client, turn, snapshot: snapshot({ status: "completed" }), finalizationClaimId: "owner-1" })
    expect(chat.updateMany.mock.calls[0][0].where.finalizationClaimId).toBe("owner-1")
  })

  it("returns failure on a message write error so the caller can still release the turn", async () => {
    const { client, message } = makeClient()
    message.update.mockRejectedValueOnce(new Error("invalid byte sequence 0x00"))
    expect((await persistAgentSnapshot({ prisma: client, turn, snapshot: snapshot(), finalizationClaimId: "owner-1" })).persisted).toBe(false)
  })

  it("sanitizes content and nested tool data", async () => {
    const { client, message } = makeClient()
    await persistAgentSnapshot({ prisma: client, turn, snapshot: snapshot({ content: `a${NUL}b`, toolCalls: [{ tool: "shell", summary: `x${NUL}y` }] }) })
    expect(message.update.mock.calls[0][0].data).toMatchObject({ content: "ab", toolCalls: [{ tool: "shell", summary: "xy" }] })
  })
})

describe("pg-sanitize", () => {
  it("removes NUL characters from strings", () => {
    expect(stripNullBytes(`a${NUL}b${NUL}c`)).toBe("abc")
    expect(stripNullBytes("clean")).toBe("clean")
  })

  it("deep-cleans nested JSON without mutating the input", () => {
    const input = { tool: `gr${NUL}ep`, args: [`x${NUL}`, { k: `v${NUL}` }], n: 3 }
    expect(stripNullBytesDeep(input)).toEqual({ tool: "grep", args: ["x", { k: "v" }], n: 3 })
    expect(input.tool).toBe(`gr${NUL}ep`)
  })
})
