import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { setupTestAuth } from "./helpers"

// Controlled transport/reconnect tests. No model or sandbox is started: the
// synthetic chat has a dispatch reservation while its real DB/API is exercised.
test("a rejected local prompt is visible as failed and does not block the next valid prompt", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    expect(created.ok()).toBe(true)
    chatId = (await created.json()).id
    await db.chat.update({ where: { id: chatId! }, data: { queueDispatchId: `test-${chatId}` } })
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Initial history", timestamp: BigInt(Date.now()) } })
    let rejectedRequests = 0
    await page.route(`**/api/chats/${chatId}/queue`, (route) => {
      const body = route.request().method() === "POST" ? route.request().postDataJSON() : null
      if (body?.content === "Rejected prompt" || body?.legacyItems?.some((item: { content: string }) => item.content === "Rejected prompt")) {
        rejectedRequests++
        return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Invalid queued prompt"}' })
      }
      return route.continue()
    })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("Rejected prompt")
    await input.press("Enter")
    await expect(page.getByText("Not sent: Invalid queued prompt", { exact: true })).toBeVisible()
    await expect(page.getByTestId("starting-indicator")).toHaveCount(0)
    await input.fill("Valid next prompt")
    await input.press("Enter")
    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, content: "Valid next prompt" } })).toBe(1)
    expect(await db.queuedPrompt.count({ where: { chatId, content: "Rejected prompt" } })).toBe(0)
    await page.reload()
    await expect(page.getByText("Not sent: Invalid queued prompt", { exact: true })).toBeVisible()
    expect(rejectedRequests).toBe(1)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("an offline removal survives navigation and is confirmed without resending the prompt", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" } })
    chatId = (await created.json()).id
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Active turn", timestamp: BigInt(Date.now()) } })
    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await expect(input).toBeVisible()
    await context.setOffline(true)
    await input.fill("Remove while offline")
    await input.press("Enter")
    const queue = page.getByTestId("prompt-queue")
    await expect(queue.getByText("Remove while offline", { exact: true })).toBeVisible()
    await queue.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Remove from queue" }).click()
    await expect(queue.getByText("Removal pending confirmation…", { exact: true })).toBeVisible()
    await page.goto("about:blank")
    await context.setOffline(false)
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByText("Remove while offline", { exact: true })).toHaveCount(0)
    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, status: "cancelled" } })).toBe(1)
    expect(await db.queuedPrompt.count({ where: { chatId, status: { in: ["queued", "dispatching", "started"] } } })).toBe(0)
    expect(await db.message.count({ where: { chatId, content: "Remove while offline" } })).toBe(0)
  } finally {
    await context.setOffline(false)
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a ready observer reloads missed history after reconnect without a status transition", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined
  try {
    const created = await page.request.post("/api/chats", { data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" } })
    chatId = (await created.json()).id
    await db.message.create({ data: { chatId: chatId!, role: "user", content: "Old history", timestamp: BigInt(Date.now() - 1000) } })
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByText("Old history", { exact: true })).toBeVisible()
    await context.setOffline(true)
    await db.message.createMany({ data: [
      { chatId: chatId!, role: "user", content: "Missed prompt 8421", timestamp: BigInt(Date.now()) },
      { chatId: chatId!, role: "assistant", content: "Reply 8421", timestamp: BigInt(Date.now() + 1) },
    ] })
    await db.chat.update({ where: { id: chatId! }, data: { status: "ready" } })
    await context.setOffline(false)
    await expect(page.getByText("Missed prompt 8421", { exact: true })).toBeVisible()
    await expect(page.getByText("Reply 8421", { exact: true })).toBeVisible()
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
  } finally {
    await context.setOffline(false)
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})
