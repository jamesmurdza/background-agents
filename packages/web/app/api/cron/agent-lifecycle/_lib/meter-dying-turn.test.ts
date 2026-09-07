/**
 * Tests for metering a turn the cron is about to tear down.
 *
 * The bug these cover was one of ordering, not arithmetic: markChatError and
 * failScheduledRun cleared `backgroundSessionId` — and, for a scheduled run,
 * deleted the sandbox — before anything had read the turn's usage. Both are the
 * only handles metering has, so a crashed or timed-out turn was not merely
 * unbilled but unrecoverable. 262 of 548 agent-stopped events in production
 * recorded nothing at all.
 *
 * So what is asserted here is sequence: the meter must run, and it must run
 * first. A test that only checked "usage was recorded" would still pass against
 * the broken code if the teardown happened to be slower.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

/** Every call the code under test makes, in the order it made them. */
let calls: string[] = []

/** Args of the last meterAssistantTurn call, so the id passed can be asserted. */
let meteredWith: { sessionId?: string | null } | undefined

const meterAssistantTurn = vi.fn(async (_sandbox: unknown, params: { sessionId?: string | null }) => {
  calls.push("meter")
  meteredWith = params
  return 1
})

vi.mock("@/lib/server/token-metering", () => ({
  meterAssistantTurn: (...args: unknown[]) =>
    meterAssistantTurn(...(args as Parameters<typeof meterAssistantTurn>)),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chat: {
      update: vi.fn(async () => {
        calls.push("clear-session")
        return {}
      }),
    },
    message: {
      create: vi.fn(async () => {
        calls.push("error-message")
        return {}
      }),
      findFirst: vi.fn(async () => ({ id: "msg_1", metadata: null })),
    },
  },
}))

import { meterDyingTurn } from "./meter-dying-turn"
import { markChatError } from "./interactive"

/** A sandbox handle; the metering call is mocked, so it is never used. */
const sandbox = {}
const daytona = { get: vi.fn(async () => sandbox) } as never

// The two ids are deliberately unalike. Chat.backgroundSessionId is a Daytona
// handle (a UUID); the agent CLI's session id is what tokscale files usage
// under ("ses_…"). They never coincide in production, so a test that used one
// value for both would pass while the code metered a session that does not
// exist — which is exactly the mistake this file now guards.
const BACKGROUND_SESSION_ID = "64b0cd9f-807c-42f3-bcf1-000000000000"
const AGENT_SESSION_ID = "ses_0f954b136ffe7xPfv2"

const dyingChat = {
  id: "chat_1",
  userId: "user_1",
  agent: "opencode",
  sandboxId: "sandbox_1",
  sessionId: null as string | null,
}

beforeEach(() => {
  calls = []
  meteredWith = undefined
  meterAssistantTurn.mockClear()
})

describe("meterDyingTurn", () => {
  it("meters the turn when the sandbox and session are still around", async () => {
    const rows = await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      agentSessionId: AGENT_SESSION_ID,
      daytona,
    })
    expect(rows).toBe(1)
    expect(meterAssistantTurn).toHaveBeenCalledTimes(1)
  })

  it("meters under the AGENT session id, never the Daytona handle", async () => {
    // tokscale files usage under the CLI's session id and filters on an exact
    // match, so passing backgroundSessionId matches nothing and silently bills
    // zero — no error, no row, no clue. Production has never held a usage row
    // whose sessionId was a backgroundSessionId.
    await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      agentSessionId: AGENT_SESSION_ID,
      daytona,
    })
    expect(meteredWith?.sessionId).toBe(AGENT_SESSION_ID)
    expect(meteredWith?.sessionId).not.toBe(BACKGROUND_SESSION_ID)
  })

  it("falls back to the chat's resume pointer when the snapshot had no id", async () => {
    // A resumed turn continues Chat.sessionId, so the CLI reports under it.
    await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      agentSessionId: undefined,
      fallbackSessionId: AGENT_SESSION_ID,
      daytona,
    })
    expect(meteredWith?.sessionId).toBe(AGENT_SESSION_ID)
  })

  it("prefers the snapshot's id over a stale resume pointer", async () => {
    await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      agentSessionId: AGENT_SESSION_ID,
      fallbackSessionId: "ses_stale_from_an_older_turn",
      daytona,
    })
    expect(meteredWith?.sessionId).toBe(AGENT_SESSION_ID)
  })

  it.each([
    ["no sandbox", { sandboxId: null }],
    ["no session id at all", { agentSessionId: null, fallbackSessionId: null }],
    ["no daytona client", { daytona: undefined }],
  ])("does nothing and does not throw when there is %s", async (_label, over) => {
    const rows = await meterDyingTurn({
      ...dyingChat,
      chatId: "chat_1",
      agentSessionId: AGENT_SESSION_ID,
      daytona,
      ...over,
    })
    expect(rows).toBe(0)
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })

  it("swallows a metering failure — a bad turn must not get worse", async () => {
    meterAssistantTurn.mockRejectedValueOnce(new Error("tokscale exploded"))
    await expect(
      meterDyingTurn({
        ...dyingChat,
        chatId: "chat_1",
        agentSessionId: AGENT_SESSION_ID,
        daytona,
      })
    ).resolves.toBe(0)
  })
})

describe("markChatError", () => {
  it("meters BEFORE clearing the session id", async () => {
    await markChatError(dyingChat, "Run exceeded 25 minute limit", daytona, AGENT_SESSION_ID)
    // The whole bug in one assertion: reverse these two and the turn's usage is
    // gone, because the cursor it would be diffed against no longer exists.
    expect(calls).toEqual(["meter", "clear-session", "error-message"])
  })

  it("still releases the chat when metering throws", async () => {
    meterAssistantTurn.mockRejectedValueOnce(new Error("tokscale exploded"))
    await markChatError(dyingChat, "Agent stopped", daytona, AGENT_SESSION_ID)
    // Metering is best-effort. A chat stranded as "running" is a worse failure
    // than an unbilled turn, so the teardown must survive it.
    expect(calls).toEqual(["clear-session", "error-message"])
  })

  it("still releases the chat when there is nothing to meter", async () => {
    await markChatError({ ...dyingChat, sandboxId: null }, "Agent stopped", daytona, AGENT_SESSION_ID)
    expect(calls).toEqual(["clear-session", "error-message"])
    expect(meterAssistantTurn).not.toHaveBeenCalled()
  })
})
