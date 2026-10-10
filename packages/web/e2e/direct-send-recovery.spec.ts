import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { setupTestAuth } from "./helpers"

test.setTimeout(150_000)
test.use({ navigationTimeout: 60_000 })

// Controlled HTTP outcomes with the real UI and database. No sandbox/model is
// started; these checks do not stand in for a live provider failure reproduction.
for (const status of [500, 502]) test(`a first send rejected with HTTP ${status} survives refresh without replacing a newer draft or retrying`, async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  let sends = 0
  let release!: () => void
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await page.route(`**/api/chats/${chatId}/messages`, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      sends++
      await responseGate
      await db.chat.update({ where: { id: chatId! }, data: { status: "error" } })
      await route.fulfill(status === 500
        ? { status, contentType: "application/json", body: '{"error":"Sandbox quota exceeded"}' }
        : { status, contentType: "text/html", body: '<h1>Gateway error: invalid upstream response</h1>' })
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Original first prompt 11901")
    await input.press("Enter")
    await expect.poll(() => sends).toBe(1)
    await input.fill("Newer unsent draft 11902")
    release()
    await expect(page.getByText("Original first prompt 11901", { exact: true })).toBeVisible()
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByText("Original first prompt 11901", { exact: true })).toBeVisible()
    await expect(page.getByTestId("direct-send-recovery")).toContainText("Send status is unconfirmed")
    const retainedPrompt = await page.getByTestId("direct-send-recovery").getByTestId("user-message").boundingBox()
    const recoveryBanner = await page.getByTestId("direct-send-recovery").getByTestId("chat-error-banner").boundingBox()
    expect(retainedPrompt).not.toBeNull()
    expect(recoveryBanner).not.toBeNull()
    expect(recoveryBanner!.y).toBeGreaterThanOrEqual(retainedPrompt!.y + retainedPrompt!.height)
    await expect(input).toHaveValue("Newer unsent draft 11902")
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
    // Cross the importer interval: a durable direct intent is not a queue job.
    await page.waitForTimeout(16_000)
    expect(sends).toBe(1)
    expect(await db.message.count({ where: { chatId } })).toBe(0)
    expect(await db.queuedPrompt.count({ where: { chatId } })).toBe(0)
    let deletes = 0
    page.on("request", (request) => { if (request.method() === "DELETE") deletes++ })
    await page.getByRole("button", { name: "Dismiss local copy", exact: true }).click()
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    await expect(input).toHaveValue("Newer unsent draft 11902")
    expect(deletes).toBe(0)
    expect(sends).toBe(1)
  } finally {
    release()
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
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByText("Please say 4", { exact: true })).toHaveCount(1, { timeout: 45_000 })
    await expect(page.getByText("4", { exact: true })).toBeVisible()
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    expect(sends).toBe(1)
    expect(await db.message.count({ where: { chatId } })).toBe(2)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("refresh during an unresolved send retains the intent and later acknowledges the exact server message", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  let sends = 0
  let release!: () => void
  const responseGate = new Promise<void>((resolve) => { release = resolve })
  let handoff: Promise<void> | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    chatId = (await created.json()).id
    await page.route(`**/api/chats/${chatId}/messages`, (route) => {
      if (route.request().method() !== "POST") return route.continue()
      sends++
      const payload = route.request().postDataJSON()
      handoff = (async () => {
        await responseGate
        const now = Date.now()
        await db.message.createMany({ data: [
          { id: payload.userMessageId, chatId: chatId!, role: "user", content: payload.message, timestamp: BigInt(now) },
          { id: payload.assistantMessageId, chatId: chatId!, role: "assistant", content: "Saved reply 11903", timestamp: BigInt(now + 1) },
        ] })
        await db.chat.update({ where: { id: chatId! }, data: { status: "ready" } })
        await route.abort("failed").catch(() => {})
      })()
      return handoff
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Unresolved original 11903")
    await input.press("Enter")
    await expect.poll(() => sends).toBe(1)
    await input.fill("Draft typed during the request 11904")
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByText("Unresolved original 11903", { exact: true })).toBeVisible()
    await expect(page.getByTestId("direct-send-recovery")).toBeVisible()
    await expect(input).toHaveValue("Draft typed during the request 11904")
    release()
    await expect(page.getByText("Saved reply 11903", { exact: true })).toBeVisible()
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    await expect(page.getByText("Unresolved original 11903", { exact: true })).toHaveCount(1)
    expect(sends).toBe(1)
    expect(await db.queuedPrompt.count({ where: { chatId } })).toBe(0)
  } finally {
    release()
    await handoff?.catch(() => {})
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("explicit free-model fallback replaces the rejected device copy and keeps one saved prompt", async ({ page, context }) => {
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
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("user-message").filter({ hasText: "Original limited prompt 11905" })).toHaveCount(1, { timeout: 45_000 })
    await expect(page.getByText("Saved fallback 11905", { exact: true })).toBeVisible()
    await expect(page.getByTestId("direct-send-recovery")).toHaveCount(0)
    expect(sends).toBe(2)
    expect(await db.message.count({ where: { chatId } })).toBe(2)
    expect(await db.queuedPrompt.count({ where: { chatId } })).toBe(0)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})
