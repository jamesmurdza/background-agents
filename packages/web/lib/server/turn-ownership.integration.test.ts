import { afterAll, beforeAll, describe, expect, it } from "vitest"

type PrismaClient = typeof import("@/lib/db/prisma").prisma
type TurnOwnership = typeof import("./turn-ownership")
type PromptQueue = typeof import("./prompt-queue")
type PersistSnapshot = typeof import("@/app/api/agent/stream/_lib/persist-snapshot").persistAgentSnapshot

let prisma: PrismaClient
let claimTurnFinalization: TurnOwnership["claimTurnFinalization"]
let releaseTurn: TurnOwnership["releaseTurn"]
let claimNextPrompt: PromptQueue["claimNextPrompt"]
let enqueuePrompt: PromptQueue["enqueuePrompt"]
let persistAgentSnapshot: PersistSnapshot

const run = crypto.randomUUID()
let userId: string
let chatId: string
const turnA = { chatId: "", backgroundSessionId: `run-A-${run}`, assistantMessageId: `assistant-A-${run}` }
const turnB = { chatId: "", backgroundSessionId: `run-B-${run}`, assistantMessageId: `assistant-B-${run}` }

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip

databaseDescribe("turn ownership on a real database", () => {
beforeAll(async () => {
  ;({ prisma } = await import("@/lib/db/prisma"))
  ;({ claimTurnFinalization, releaseTurn } = await import("./turn-ownership"))
  ;({ claimNextPrompt, enqueuePrompt } = await import("./prompt-queue"))
  ;({ persistAgentSnapshot } = await import("@/app/api/agent/stream/_lib/persist-snapshot"))
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
})
