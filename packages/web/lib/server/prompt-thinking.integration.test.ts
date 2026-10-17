import { afterAll, beforeAll, expect, it } from "vitest"
import { createTestUser, databaseDescribe, deleteTestUser } from "./db-test-helpers"

type Database = typeof import("@/lib/db/prisma").prisma
type Queue = typeof import("./prompt-queue")
let prisma: Database
let queue: Queue
let userId: string

databaseDescribe("per-prompt thinking on the real server queue", () => {
  beforeAll(async () => {
    ;({ prisma, userId } = await createTestUser("thinking"))
    queue = await import("./prompt-queue")
  })
  afterAll(() => deleteTestUser(prisma, userId))
  const input = (thinking?: string) => ({ clientId: crypto.randomUUID(), content: `prompt-${thinking ?? "legacy"}`, agent: "codex", model: "gpt-6.1-sol", thinking })

  it("freezes each selection across concurrent submissions and one winning worker", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entries = [input("low"), input("high"), input("default"), input()]
    await Promise.all(entries.map(entry => queue.enqueuePrompt(chat.id, entry)))
    const stored = await prisma.queuedPrompt.findMany({ where: { chatId: chat.id }, orderBy: { position: "asc" } })
    for (const entry of entries) expect(stored.find(row => row.clientId === entry.clientId)?.thinking).toBe(entry.thinking === "default" ? null : entry.thinking ?? null)
    const claims = await Promise.all([queue.claimNextPrompt(chat.id), queue.claimNextPrompt(chat.id)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)?.thinking).toBe(stored[0].thinking)
    expect(queue.toQueuedMessage(stored[0]).thinking).toBe(stored[0].thinking ?? undefined)
  })

  it("deduplicates retries but rejects a changed thinking value for the same ID", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entry = input("low")
    const [first, retry] = await Promise.all([queue.enqueuePrompt(chat.id, entry), queue.enqueuePrompt(chat.id, entry)])
    expect(first.id).toBe(retry.id)
    await expect(queue.enqueuePrompt(chat.id, { ...entry, thinking: "high" })).rejects.toThrow("different prompt")
    await expect(queue.importLegacyPrompts(chat.id, [{ ...entry, thinking: "high" }], false)).rejects.toThrow("different prompt")
    expect(await prisma.queuedPrompt.count({ where: { chatId: chat.id } })).toBe(1)
  })

  it("imports offline selections unchanged and treats legacy/default identically", async () => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entries = [input("high"), input()]
    await queue.importLegacyPrompts(chat.id, entries, true)
    const replay = await queue.enqueuePrompt(chat.id, { ...entries[1], thinking: "default" })
    expect(replay.thinking).toBeNull()
    expect(await queue.claimNextPrompt(chat.id)).toBeNull()
    const row = await prisma.queuedPrompt.findUniqueOrThrow({ where: { chatId_clientId: { chatId: chat.id, clientId: entries[0].clientId } } })
    expect(row.thinking).toBe("high")
  })

  it.each([
    { agent: "gemini", model: "gemini-2.5-flash", thinking: "budget:1024", changed: "budget:2048" },
    { agent: "kilo", model: "kilo/example/model", thinking: "variant:deep-review", changed: "variant:quick" },
  ])("preserves $agent native selections through offline import and dispatch", async ({ changed, ...selection }) => {
    const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready" } })
    const entry = { ...input(), ...selection }
    await queue.importLegacyPrompts(chat.id, [entry], false)
    const replay = await queue.enqueuePrompt(chat.id, entry)
    expect(replay.thinking).toBe(selection.thinking)
    await expect(queue.enqueuePrompt(chat.id, { ...entry, thinking: changed })).rejects.toThrow("different prompt")
    const claim = await queue.claimNextPrompt(chat.id)
    expect(claim?.thinking).toBe(selection.thinking)
    expect(queue.toQueuedMessage(replay).thinking).toBe(selection.thinking)
  })
})
