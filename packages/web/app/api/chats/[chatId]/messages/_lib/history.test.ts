import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const findMany = vi.fn()

vi.mock("@/lib/db/prisma", () => ({
  prisma: { message: { findFirst, findMany } },
}))

const { buildAgentHistory } = await import("./history")

const payload = {
  agent: "claude-code",
  userMessageId: "msg_queued",
} as never as Parameters<typeof buildAgentHistory>[2]

const chat = { parentChatId: null } as never as Parameters<typeof buildAgentHistory>[1]

describe("buildAgentHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("replays this chat's history on an agent switch", async () => {
    findFirst.mockResolvedValue({ agent: "opencode" })
    findMany.mockResolvedValue([
      { id: "m1", role: "user", content: "earlier" },
      { id: "m2", role: "assistant", content: "reply" },
    ])

    const { history, isAgentSwitch } = await buildAgentHistory("chat_1", chat, payload)

    expect(isAgentSwitch).toBe(true)
    expect(history).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "reply" },
    ])
  })

  it("never replays the message this turn is about to send", async () => {
    // A turn held by a setup script persists its user message before the turn
    // runs, so without the exclusion the agent would receive it twice: once in
    // the replay and once as the prompt.
    findFirst.mockResolvedValue({ agent: "opencode" })
    findMany.mockResolvedValue([
      { id: "m1", role: "user", content: "earlier" },
      { id: "m2", role: "assistant", content: "reply" },
      { id: "msg_queued", role: "user", content: "the queued message" },
    ])

    const { history } = await buildAgentHistory("chat_1", chat, payload)

    expect(history?.map((m) => m.content)).toEqual(["earlier", "reply"])
  })
})
