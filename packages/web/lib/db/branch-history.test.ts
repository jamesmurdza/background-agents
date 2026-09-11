/**
 * A branch's inherited history is a snapshot, not a live view.
 *
 * The parent keeps being used after a branch is taken; those later turns belong
 * to the parent alone. They must never show up in the branch's rendered history
 * or in the context replayed to the branch's agent — which is what happened
 * before the branch-point cutoff existed: the parent's new messages appeared in
 * the child on the next full fetch (i.e. after a page refresh).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface FakeMessage {
  id: string
  chatId: string
  role: string
  content: string
  timestamp: bigint
  createdAt: Date
}

let rows: FakeMessage[] = []

/** Minimal stand-in for the subset of `findMany` this module uses. */
function findMany(args: {
  where: { chatId: string; role: { in: string[] }; createdAt: { lte: Date } }
  orderBy: { timestamp: "asc" }
  select?: Record<string, boolean>
}) {
  const { where } = args
  return Promise.resolve(
    rows
      .filter(
        (m) =>
          m.chatId === where.chatId &&
          where.role.in.includes(m.role) &&
          m.createdAt.getTime() <= where.createdAt.lte.getTime()
      )
      .sort((a, b) => Number(a.timestamp - b.timestamp))
  )
}

vi.mock("@/lib/db/prisma", () => ({
  prisma: { message: { findMany: (args: never) => findMany(args) } },
}))

import { getInheritedMessages, getInheritedHistory } from "./branch-history"

const BRANCHED_AT = new Date("2026-09-11T12:00:00Z")

function message(overrides: Partial<FakeMessage> & { id: string }): FakeMessage {
  const createdAt = overrides.createdAt ?? new Date(BRANCHED_AT.getTime() - 1000)
  return {
    chatId: "parent",
    role: "user",
    content: `content-${overrides.id}`,
    timestamp: BigInt(createdAt.getTime()),
    createdAt,
    ...overrides,
  }
}

const branchPoint = { parentChatId: "parent", createdAt: BRANCHED_AT }

beforeEach(() => {
  rows = []
})

describe("getInheritedMessages", () => {
  it("returns the parent's conversation as it stood at the branch point", async () => {
    rows = [
      message({ id: "m1", createdAt: new Date(BRANCHED_AT.getTime() - 2000) }),
      message({ id: "m2", role: "assistant", createdAt: new Date(BRANCHED_AT.getTime() - 1000) }),
    ]

    const inherited = await getInheritedMessages(branchPoint)

    expect(inherited.map((m) => m.id)).toEqual(["m1", "m2"])
  })

  it("excludes parent turns that happened after the branch was taken", async () => {
    rows = [
      message({ id: "before" }),
      message({ id: "after", createdAt: new Date(BRANCHED_AT.getTime() + 5000) }),
      message({
        id: "after-reply",
        role: "assistant",
        createdAt: new Date(BRANCHED_AT.getTime() + 6000),
      }),
    ]

    const inherited = await getInheritedMessages(branchPoint)

    expect(inherited.map((m) => m.id)).toEqual(["before"])
  })

  it("ignores other chats' messages and blank content", async () => {
    rows = [
      message({ id: "kept" }),
      message({ id: "other-chat", chatId: "unrelated" }),
      message({ id: "blank", content: "   " }),
    ]

    const inherited = await getInheritedMessages(branchPoint)

    expect(inherited.map((m) => m.id)).toEqual(["kept"])
  })
})

describe("getInheritedHistory", () => {
  it("replays the branch-point conversation to the agent, and nothing later", async () => {
    rows = [
      message({ id: "m1", content: "first" }),
      message({ id: "m2", role: "assistant", content: "reply" }),
      message({ id: "m3", content: "later", createdAt: new Date(BRANCHED_AT.getTime() + 1000) }),
    ]

    const history = await getInheritedHistory(branchPoint)

    expect(history).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
    ])
  })

  it("returns undefined when there is nothing to replay", async () => {
    rows = [message({ id: "blank", content: "" })]

    expect(await getInheritedHistory(branchPoint)).toBeUndefined()
  })
})
