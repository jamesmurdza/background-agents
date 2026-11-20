import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { setupTestAuth } from "./helpers"

test.setTimeout(150_000)
test.use({ navigationTimeout: 60_000 })

// Controlled HTTP outcomes with the real UI and database. No sandbox/model is
// started; these checks do not stand in for a live provider failure reproduction.
// The server either records the failed turn or never sees the send (e.g. a 400 or a lost request).
for (const serverRecordsFailure of [true, false]) test(`a first send rejected by the server stays on screen with Retry and is not resent (${serverRecordsFailure ? "server records the failure" : "server never saw it"})`, async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  let sends = 0
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await page.route(`**/api/chats/${chatId}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      sends++
      if (serverRecordsFailure) await db.chat.update({ where: { id: chatId! }, data: { status: "error" } })
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Sandbox quota exceeded"}' })
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Original first prompt 11901")
    await input.press("Enter")
    await expect(page.getByText("Original first prompt 11901", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible()
    // Still there after the next queue poll, and never sent again on its own.
    await page.waitForTimeout(6_000)
    await expect(page.getByText("Original first prompt 11901", { exact: true })).toBeVisible()
    await expect(page.getByText("Sandbox quota exceeded")).toBeVisible()
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible()
    expect(sends).toBe(1)
    expect(await db.message.count({ where: { chatId } })).toBe(0)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a lost send response reconciles the exact saved reply without resending", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  let sends = 0
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await page.route(`**/api/chats/${chatId}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      sends++
      const payload = route.request().postDataJSON()
      const now = Date.now()
      await db.message.createMany({ data: [
        { id: payload.userMessageId, chatId: chatId!, role: "user", content: payload.message, timestamp: BigInt(now) },
        { id: payload.assistantMessageId, chatId: chatId!, role: "assistant", content: "4", timestamp: BigInt(now + 1) },
      ] })
      await db.chat.update({ where: { id: chatId! }, data: { status: "ready" } })
      await route.abort("failed")
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Please say 4")
    await input.press("Enter")
    await expect(page.getByText("4", { exact: true })).toBeVisible()
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByText("Please say 4", { exact: true })).toHaveCount(1, { timeout: 45_000 })
    await expect(page.getByText("4", { exact: true })).toBeVisible()
    expect(sends).toBe(1)
    expect(await db.message.count({ where: { chatId } })).toBe(2)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("explicit free-model fallback keeps one saved prompt", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  let sends = 0
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await page.route(`**/api/chats/${chatId}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      sends++
      if (sends === 1) return route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"DAILY_LIMIT_EXCEEDED","provider":"claude","creditBalance":0}' })
      const payload = route.request().postDataJSON()
      expect(payload.agent).toBe("opencode")
      const now = Date.now()
      await db.message.createMany({ data: [
        { id: payload.userMessageId, chatId: chatId!, role: "user", content: payload.message, timestamp: BigInt(now) },
        { id: payload.assistantMessageId, chatId: chatId!, role: "assistant", content: "Saved fallback 11905", timestamp: BigInt(now + 1) },
      ] })
      await db.chat.update({ where: { id: chatId! }, data: { status: "running", backgroundSessionId: "controlled-fallback", activeAssistantMessageId: payload.assistantMessageId } })
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sandboxId: "controlled-sandbox", backgroundSessionId: "controlled-fallback", uploadedFiles: [], branch: null, previewUrlPattern: null }) })
    })
    await page.route("**/api/agent/stream?*", async (route) => {
      await db.chat.update({ where: { id: chatId! }, data: { status: "ready", backgroundSessionId: null, activeAssistantMessageId: null } })
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: 'event: update\ndata: {"content":"Saved fallback 11905","toolCalls":[],"contentBlocks":[],"cursor":1}\n\nevent: complete\ndata: {"status":"completed","cursor":2}\n\n' })
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Original limited prompt 11905")
    await input.press("Enter")
    await page.getByRole("button", { name: "Continue with OpenCode" }).click()
    await expect(page.getByText("Saved fallback 11905", { exact: true })).toBeVisible()
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("user-message").filter({ hasText: "Original limited prompt 11905" })).toHaveCount(1, { timeout: 45_000 })
    await expect(page.getByText("Saved fallback 11905", { exact: true })).toBeVisible()
    expect(sends).toBe(2)
    expect(await db.message.count({ where: { chatId } })).toBe(2)
    expect(await db.queuedPrompt.count({ where: { chatId } })).toBe(0)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})
