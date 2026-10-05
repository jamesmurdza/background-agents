import { afterAll, beforeAll, describe, expect, it } from "vitest"

type Database = typeof import("@/lib/db/prisma").prisma
type Queue = typeof import("./prompt-queue")
let prisma: Database
let queue: Queue
let userId: string
const run = crypto.randomUUID()
const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip

databaseDescribe("idempotent prompt cancellation on a real database", () => {
  beforeAll(async () => {
    ;({ prisma } = await import("@/lib/db/prisma"))
    queue = await import("./prompt-queue")
    userId = (await prisma.user.create({ data: { email: `queue-cancel-${run}@example.test` } })).id
  })
  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })
  const input = (clientId: string) => ({ clientId, content: "cancel this prompt", agent: "eliza", model: "eliza-classic-1.0" })

  it("remembers removal before a delayed send or import arrives", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`before-${run}`)
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(true)
    expect((await queue.enqueuePrompt(chat.id, prompt)).status).toBe("cancelled")
    expect((await queue.importLegacyPrompts(chat.id, [prompt], false))[0].status).toBe("cancelled")
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
    expect(await prisma.queuedPrompt.count({ where: { chatId: chat.id } })).toBe(1)
  })

  it("is idempotent when concurrent sends and removals share one request identity", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`concurrent-${run}`)
    await Promise.all([
      queue.enqueuePrompt(chat.id, prompt),
      queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId }),
      queue.enqueuePrompt(chat.id, prompt),
    ])
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(true)
    expect((await prisma.queuedPrompt.findMany({ where: { chatId: chat.id } })).map((row) => row.status)).toEqual(["cancelled"])
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
  })

  it("does not report successful removal once a worker has claimed the prompt", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const prompt = input(`claimed-${run}`)
    await queue.enqueuePrompt(chat.id, prompt)
    expect(await queue.claimNextPrompt(chat.id)).not.toBeNull()
    expect(await queue.cancelQueuedPrompt(chat.id, { clientId: prompt.clientId })).toBe(false)
  })
})
