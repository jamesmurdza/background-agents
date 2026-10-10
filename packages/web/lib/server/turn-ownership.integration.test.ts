import { afterAll, beforeAll, describe, expect, it } from "vitest"

type PrismaClient = typeof import("@/lib/db/prisma").prisma
type TurnOwnership = typeof import("./turn-ownership")
type PromptQueue = typeof import("./prompt-queue")
type PersistSnapshot = typeof import("@/app/api/agent/stream/_lib/persist-snapshot").persistAgentSnapshot
type SnapshotPersistClient = import("@/app/api/agent/stream/_lib/persist-snapshot").SnapshotPersistClient
type TurnFailure = typeof import("./turn-failure")

let prisma: PrismaClient
let claimTurnFinalization: TurnOwnership["claimTurnFinalization"]
let releaseTurn: TurnOwnership["releaseTurn"]
let abandonFinalization: TurnOwnership["abandonFinalization"]
let claimNextPrompt: PromptQueue["claimNextPrompt"]
let enqueuePrompt: PromptQueue["enqueuePrompt"]
let persistAgentSnapshot: PersistSnapshot
let recordTurnFailure: TurnFailure["recordTurnFailure"]
let readTurnFailure: TurnFailure["readTurnFailure"]

const run = crypto.randomUUID()
let userId: string
let chatId: string
const turnA = { chatId: "", backgroundSessionId: `run-A-${run}`, assistantMessageId: `assistant-A-${run}` }
const turnB = { chatId: "", backgroundSessionId: `run-B-${run}`, assistantMessageId: `assistant-B-${run}` }

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip

databaseDescribe("turn ownership on a real database", () => {
beforeAll(async () => {
  ;({ prisma } = await import("@/lib/db/prisma"))
  ;({ claimTurnFinalization, releaseTurn, abandonFinalization } = await import("./turn-ownership"))
  ;({ claimNextPrompt, enqueuePrompt } = await import("./prompt-queue"))
  ;({ persistAgentSnapshot } = await import("@/app/api/agent/stream/_lib/persist-snapshot"))
  ;({ recordTurnFailure, readTurnFailure } = await import("./turn-failure"))
  const user = await prisma.user.create({ data: { email: `turn-ownership-${run}@example.test` } })
  userId = user.id
  const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "running", backgroundSessionId: turnA.backgroundSessionId, activeAssistantMessageId: turnA.assistantMessageId } })
  chatId = chat.id
  turnA.chatId = chatId
  turnB.chatId = chatId
  await prisma.message.createMany({ data: [
    { id: turnA.assistantMessageId, chatId, role: "assistant", content: "", timestamp: 1n },
    { id: turnB.assistantMessageId, chatId, role: "assistant", content: "", timestamp: 2n },
  ] })
})

afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})

  it("allows exactly one finalizer across concurrent observers", async () => {
    const claims = await Promise.all(Array.from({ length: 16 }, () => claimTurnFinalization(turnA)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = claims.find(Boolean)!
    expect(await releaseTurn(turnA, "not-the-owner", "ready")).toBe(false)
    expect(await releaseTurn(turnA, winner, "ready")).toBe(true)
  })

  it("cannot release or write a subsequent turn using the previous turn's identity", async () => {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "running", backgroundSessionId: turnB.backgroundSessionId, activeAssistantMessageId: turnB.assistantMessageId } })
    const ownerB = await claimTurnFinalization(turnB)
    expect(ownerB).toBeTruthy()
    expect(await releaseTurn(turnA, "old-owner", "ready")).toBe(false)
    expect((await persistAgentSnapshot({
      prisma, turn: turnA,
      snapshot: { status: "completed", content: "wrong answer", toolCalls: [], contentBlocks: [], sessionId: "old-session" },
    })).persisted).toBe(false)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: turnA.assistantMessageId } })).content).toBe("")
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: chatId } })).backgroundSessionId).toBe(turnB.backgroundSessionId)
    expect(await releaseTurn(turnB, ownerB!, "ready")).toBe(true)
  })

  it("never claims another queued prompt while a turn is running or finalizing", async () => {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "running", backgroundSessionId: turnB.backgroundSessionId, activeAssistantMessageId: turnB.assistantMessageId } })
    await enqueuePrompt(chatId, { clientId: run, content: "say 3", agent: "eliza", model: "eliza-classic-1.0" })
    expect(await claimNextPrompt(chatId)).toBeNull()
    const owner = await claimTurnFinalization(turnB)
    expect(owner).toBeTruthy()
    expect(await claimNextPrompt(chatId)).toBeNull()
    expect(await releaseTurn(turnB, owner!, "ready")).toBe(true)
    expect((await claimNextPrompt(chatId))?.content).toBe("say 3")
  })

  it("fences a recovered claim so the original owner cannot release the chat", async () => {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "running", backgroundSessionId: turnB.backgroundSessionId, activeAssistantMessageId: turnB.assistantMessageId, queueDispatchId: null } })
    const oldOwner = await claimTurnFinalization(turnB)
    expect(oldOwner).toBeTruthy()
    await prisma.chat.update({ where: { id: chatId }, data: { finalizationClaimedAt: new Date(Date.now() - 8 * 60 * 1000) } })
    const recoveredOwner = await claimTurnFinalization(turnB)
    expect(recoveredOwner).toBeTruthy()
    expect(recoveredOwner).not.toBe(oldOwner)
    expect(await releaseTurn(turnB, oldOwner!, "ready")).toBe(false)
    expect(await releaseTurn(turnB, recoveredOwner!, "ready")).toBe(true)
  })

  it("keeps prompts enqueued during Stop paused until an explicit resume", async () => {
    const chat = await prisma.chat.create({ data: {
      userId, repo: "__new__", status: "running", backgroundSessionId: `stop-${run}`,
      activeAssistantMessageId: `stop-assistant-${run}`,
    } })
    const turn = { chatId: chat.id, backgroundSessionId: `stop-${run}`, assistantMessageId: `stop-assistant-${run}` }
    const owner = await claimTurnFinalization(turn)
    expect(owner).toBeTruthy()
    await prisma.chat.update({ where: { id: chat.id }, data: { queuePaused: true } })

    // Another tab submits while cancellation is waiting on the sandbox.
    await enqueuePrompt(chat.id, { clientId: `stop-queue-${run}`, content: "queued during stop", agent: "eliza", model: "eliza-classic-1.0" })
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).queuePaused).toBe(false)
    expect(await claimNextPrompt(chat.id)).toBeNull()

    expect(await releaseTurn(turn, owner!, "ready", undefined, { pauseQueue: true })).toBe(true)
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).queuePaused).toBe(true)
    expect(await claimNextPrompt(chat.id)).toBeNull()

    await prisma.chat.update({ where: { id: chat.id }, data: { queuePaused: false } })
    expect((await claimNextPrompt(chat.id))?.content).toBe("queued during stop")
  })

  it("fences failure intent and keeps attribution through confirmed-error recovery", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "running", backgroundSessionId: `failure-${run}`, activeAssistantMessageId: `failure-assistant-${run}` } })
    const turn = { chatId: chat.id, backgroundSessionId: `failure-${run}`, assistantMessageId: `failure-assistant-${run}` }
    await prisma.message.create({ data: { id: turn.assistantMessageId, chatId: chat.id, role: "assistant", content: "partial", timestamp: 1n, metadata: { usageSource: "preserved" } } })
    const owner = await claimTurnFinalization(turn)
    expect(owner).toBeTruthy()
    expect(await recordTurnFailure(turn, "wrong-owner", "wrong reason", true)).toBe(false)
    expect(await readTurnFailure(turn)).toBeNull()
    expect(await recordTurnFailure(turn, owner!, "time\u0000 limit", false)).toBe(true)
    expect(await readTurnFailure(turn)).toMatchObject({ reason: "time limit", executionStopped: false })
    await abandonFinalization(turn, owner!)
    const retry = await claimTurnFinalization(turn)
    expect(retry).toBeTruthy()
    expect(await recordTurnFailure(turn, owner!, "stale", true)).toBe(false)
    expect((await persistAgentSnapshot({ prisma, turn, snapshot: { status: "completed", content: "full output", toolCalls: [], contentBlocks: [] }, finalizationClaimId: retry! })).persisted).toBe(true)
    expect(await recordTurnFailure(turn, retry!, "time limit", true)).toBe(true)
    expect(await releaseTurn(turn, retry!, "error")).toBe(true)
    const message = await prisma.message.findUniqueOrThrow({ where: { id: turn.assistantMessageId } })
    expect(message.content).toBe("full output")
    expect(message.metadata).toMatchObject({ usageSource: "preserved", turnFinalization: { state: "error", executionStopped: true, assistantMessageId: turn.assistantMessageId, backgroundSessionId: turn.backgroundSessionId } })
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).status).toBe("error")
  })

  it("recovers a failed final snapshot transaction before another prompt can start", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "running", backgroundSessionId: `recover-${run}`, activeAssistantMessageId: `recover-assistant-${run}` } })
    const turn = { chatId: chat.id, backgroundSessionId: `recover-${run}`, assistantMessageId: `recover-assistant-${run}` }
    await prisma.message.create({ data: { id: turn.assistantMessageId, chatId: chat.id, role: "assistant", content: "partial", timestamp: 1n } })
    await enqueuePrompt(chat.id, { clientId: `recover-next-${run}`, content: "next prompt", agent: "eliza", model: "eliza-classic-1.0" })
    const snapshot = { status: "completed" as const, content: "complete answer after tool", toolCalls: [], contentBlocks: [] }
    const failedStore: SnapshotPersistClient = {
      chat: prisma.chat, message: prisma.message,
      $transaction: async (fn) => prisma.$transaction(async (tx) => fn({
        chat: tx.chat,
        message: { update: async (args) => {
          await tx.message.update(args)
          throw new Error("Controlled failure after write; transaction must roll back")
        } },
      })),
    }
    const first = await claimTurnFinalization(turn)
    expect((await persistAgentSnapshot({ prisma: failedStore, turn, snapshot, finalizationClaimId: first! })).persisted).toBe(false)
    await abandonFinalization(turn, first!)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: turn.assistantMessageId } })).content).toBe("partial")
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).backgroundSessionId).toBe(turn.backgroundSessionId)
    expect(await claimNextPrompt(chat.id)).toBeNull()

    const retry = await claimTurnFinalization(turn)
    expect((await persistAgentSnapshot({ prisma, turn, snapshot, finalizationClaimId: retry! })).persisted).toBe(true)
    expect(await releaseTurn(turn, retry!, "ready")).toBe(true)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: turn.assistantMessageId } })).content).toBe(snapshot.content)
    expect((await claimNextPrompt(chat.id))?.content).toBe("next prompt")
  })
})
