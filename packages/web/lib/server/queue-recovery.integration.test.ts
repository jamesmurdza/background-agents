import { afterAll, beforeAll, describe, expect, it } from "vitest"

type Database = typeof import("@/lib/db/prisma").prisma
type Queue = typeof import("./prompt-queue")
type Recovery = typeof import("./queue-recovery")
let prisma: Database
let queue: Queue
let recovery: Recovery
let userId: string
const run = crypto.randomUUID()
const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip

databaseDescribe("explicit terminal queue recovery on a real database", () => {
  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/db/prisma"))
    queue = await import("./prompt-queue")
    recovery = await import("./queue-recovery")
    userId = (await prisma.user.create({ data: { email: `queue-recovery-${run}@example.test` } })).id
  })
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })
  async function failedChat(confirmed: boolean | null = true) {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "error" } })
    const assistantMessageId = `failed-${crypto.randomUUID()}`
    await prisma.message.create({ data: { id: assistantMessageId, chatId: chat.id, role: "assistant", content: "", timestamp: 1n,
      ...(confirmed === null ? {} : { metadata: { turnFinalization: {
        state: "error", executionStopped: confirmed, backgroundSessionId: "old-job", assistantMessageId, reason: "Provider unavailable",
      } } }),
    } })
    await prisma.message.create({ data: { id: `${assistantMessageId}:error`, chatId: chat.id, role: "assistant", content: "Agent stopped", isError: true, timestamp: 2n } })
    const first = await queue.enqueuePrompt(chat.id, { clientId: crypto.randomUUID(), content: "Next one", agent: "eliza", model: "eliza-classic-1.0" })
    const second = await queue.enqueuePrompt(chat.id, { clientId: crypto.randomUUID(), content: "Next two", agent: "eliza", model: "eliza-classic-1.0" })
    const observed = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })
    return { ...observed, assistantMessageId, first, second }
  }
  it("continues only remaining FIFO items and ignores repeated/stale clicks", async () => {
    const chat = await failedChat()
    const intent = { updatedAt: chat.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId }
    expect(await recovery.recoverTerminalQueue(chat.id, intent)).toBe(true)
    expect(await recovery.recoverTerminalQueue(chat.id, intent)).toBe(false)
    const claims = await Promise.all([queue.claimNextPrompt(chat.id), queue.claimNextPrompt(chat.id)])
    expect(claims.filter(Boolean).map((item) => item!.id)).toEqual([chat.first.id])
    expect(await recovery.recoverTerminalQueue(chat.id, intent)).toBe(false)
    expect((await prisma.queuedPrompt.findUniqueOrThrow({ where: { id: chat.second.id } })).status).toBe("queued")
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(2)
  })
  it.each([false, null])("rejects unconfirmed or legacy terminal state (%s)", async (confirmed) => {
    const chat = await failedChat(confirmed)
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: chat.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId })).toBe(false)
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
  })
  it("serializes simultaneous recovery clicks with a competing dispatcher", async () => {
    const chat = await failedChat()
    const intent = { updatedAt: chat.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId }
    const [firstRecovery, secondRecovery, firstClaim] = await Promise.all([
      recovery.recoverTerminalQueue(chat.id, intent), recovery.recoverTerminalQueue(chat.id, intent), queue.claimNextPrompt(chat.id),
    ])
    expect([firstRecovery, secondRecovery].filter(Boolean)).toHaveLength(1)
    const nextClaim = await queue.claimNextPrompt(chat.id)
    expect([firstClaim, nextClaim].filter(Boolean).map((item) => item!.id)).toEqual([chat.first.id])
  })
  it("rejects an outstanding dispatch row and mismatched terminal marker", async () => {
    const chat = await failedChat()
    const intent = { updatedAt: chat.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId }
    await prisma.queuedPrompt.update({ where: { id: chat.first.id }, data: { status: "dispatching" } })
    expect(await recovery.recoverTerminalQueue(chat.id, intent)).toBe(false)
    await prisma.queuedPrompt.update({ where: { id: chat.first.id }, data: { status: "queued" } })
    await prisma.message.update({ where: { id: chat.assistantMessageId }, data: { metadata: { turnFinalization: {
      state: "error", executionStopped: true, backgroundSessionId: "old-job", assistantMessageId: "different-message",
    } } } })
    expect(await recovery.recoverTerminalQueue(chat.id, intent)).toBe(false)
  })
  it("does not use an older failed-turn marker after a newer unmarked assistant", async () => {
    const chat = await failedChat()
    await prisma.message.create({ data: { chatId: chat.id, role: "assistant", content: "Newer unconfirmed turn", timestamp: 3n } })
    expect(await recovery.readTerminalQueueRecovery(chat.id)).toBeNull()
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: chat.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId })).toBe(false)
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
  })
  it("never treats a confirmed marker belonging to another chat as recovery permission", async () => {
    const donor = await failedChat()
    const target = await failedChat(null)
    expect(await recovery.readTerminalQueueRecovery(target.id)).toBeNull()
    expect(await recovery.recoverTerminalQueue(target.id, { updatedAt: target.updatedAt.getTime(), assistantMessageId: donor.assistantMessageId })).toBe(false)
    expect(await queue.claimNextPrompt(target.id)).toBeNull()
  })
  it.each(["backgroundSessionId", "activeAssistantMessageId", "queueDispatchId", "finalizationClaimId"] as const)("rejects an outstanding %s even when status says error", async (field) => {
    const chat = await failedChat()
    const current = await prisma.chat.update({ where: { id: chat.id }, data: { [field]: "owned" } })
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: current.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId })).toBe(false)
  })
  it("rejects a stale client revision, a different failed assistant, and disconnected state", async () => {
    const chat = await failedChat()
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: chat.updatedAt.getTime() - 1, assistantMessageId: chat.assistantMessageId })).toBe(false)
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: chat.updatedAt.getTime(), assistantMessageId: "wrong" })).toBe(false)
    const disconnected = await prisma.chat.update({ where: { id: chat.id }, data: { status: "disconnected" } })
    expect(await recovery.recoverTerminalQueue(chat.id, { updatedAt: disconnected.updatedAt.getTime(), assistantMessageId: chat.assistantMessageId })).toBe(false)
  })
})
