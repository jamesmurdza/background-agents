import { test, expect } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

test("a queued prompt is visible from another browser signed in as the same user", async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  let chatId: string | null = null

  try {
    await setupTestAuth(pageA, contextA)
    await setupTestAuth(pageB, contextB)
    await setDefaultAgentEliza(pageA)

    const create = await pageA.request.post("/api/chats", {
      data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    // Give the synthetic running chat a visible first turn. No Daytona sandbox
    // is needed for this cross-browser queue visibility test.
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
    try {
      await db.message.create({
        data: { chatId, role: "user", content: "First prompt is still running", timestamp: BigInt(Date.now()) },
      })
    } finally {
      await db.$disconnect()
    }
    const queuedText = `Cross-browser queued prompt ${chatId}`

    await pageA.goto(`/chat/${chatId}`)
    const inputA = pageA.getByTestId("chat-input")
    await expect(inputA).toBeVisible()
    await inputA.fill(queuedText)
    await inputA.press("Enter")
    await expect(pageA.getByText(queuedText)).toBeVisible()

    await pageB.goto(`/chat/${chatId}`)
    await expect(pageB.getByTestId("chat-input")).toBeVisible()
    await expect(pageB.getByText(queuedText)).toBeVisible({ timeout: 15000 })
    await pageB.reload()
    await expect(pageB.getByText(queuedText)).toBeVisible()

    const queueResponse = await pageA.request.get(`/api/chats/${chatId}/queue`)
    expect(queueResponse.ok()).toBe(true)
    const queue = await queueResponse.json()
    const item = queue.queuedMessages.find((entry: { content: string }) => entry.content === queuedText)
    expect(item?.clientId).toBeTruthy()
    const duplicate = {
      clientId: item.clientId, content: queuedText, agent: item.agent, model: item.model,
    }
    const retries = await Promise.all(Array.from({ length: 3 }, () =>
      pageA.request.post(`/api/chats/${chatId}/queue`, { data: duplicate })
    ))
    for (const response of retries) {
      expect(response.status()).toBe(201)
      expect((await response.json()).queuedMessage.id).toBe(item.id)
    }
    const afterRetries = await pageA.request.get(`/api/chats/${chatId}/queue`)
    expect((await afterRetries.json()).queuedMessages).toHaveLength(1)

    const anonymous = await browser.newContext()
    try {
      const denied = await anonymous.request.get(new URL(`/api/chats/${chatId}/queue`, pageA.url()).toString())
      expect(denied.status()).toBe(401)
    } finally {
      await anonymous.close()
    }

    const pause = await pageA.request.patch(`/api/chats/${chatId}/queue`, { data: { paused: true } })
    expect(pause.ok()).toBe(true)
    const pausedQueue = await pageA.request.get(`/api/chats/${chatId}/queue`)
    expect((await pausedQueue.json()).queuePaused).toBe(true)
    const cancel = await pageA.request.delete(`/api/chats/${chatId}/queue/${item.id}`)
    expect(cancel.ok()).toBe(true)
    await expect(pageB.getByText(queuedText)).not.toBeVisible({ timeout: 15000 })
  } finally {
    if (chatId) await pageA.request.delete(`/api/chats/${chatId}`)
    await contextA.close()
    await contextB.close()
  }
})
