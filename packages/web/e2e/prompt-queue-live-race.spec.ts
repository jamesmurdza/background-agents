import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Daytona } from "@daytonaio/sdk"
import { setupTestAuth } from "./helpers"

/**
 * Opt-in live race test. Supply a disposable, already-allocated Daytona
 * sandbox for a __new__ repo; no sandbox is created or deleted by this test.
 */
test("browser and cron start exactly one real Eliza turn", async ({ page, context }, testInfo) => {
  test.skip(!process.env.DAYTONA_RACE_SANDBOX_ID, "Set DAYTONA_RACE_SANDBOX_ID to a disposable __new__ sandbox")
  test.setTimeout(300_000)

  await setupTestAuth(page, context)
  const sandboxId = process.env.DAYTONA_RACE_SANDBOX_ID!
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  let chatId: string | undefined
  let sandboxEligible = false

  try {
    const suppliedSandbox = await daytona.get(sandboxId)
    expect(suppliedSandbox.state, "Race test must not reuse a running sandbox").toBe("stopped")
    expect(suppliedSandbox.labels.repo, "Race test needs a disposable __new__ sandbox").toBe("__new__")
    expect(suppliedSandbox.labels["simple-chat"]).toBe("true")
    sandboxEligible = true

    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.chat.update({ where: { id: chatId }, data: { sandboxId } })
    await db.message.createMany({ data: [
      { chatId, role: "user", content: "First turn already completed", timestamp: BigInt(Date.now()) },
      { chatId, role: "assistant", content: "Ready for the next prompt.", timestamp: BigInt(Date.now() + 1) },
    ] })

    const enqueue = await page.request.post(`/api/chats/${chatId}/queue`, {
      data: {
        clientId: crypto.randomUUID(), content: "Reply with RACE_OK once.",
        agent: "eliza", model: "eliza-classic-1.0",
      },
    })
    expect(enqueue.status()).toBe(201)
    const promptId = (await enqueue.json()).queuedMessage.id as string

    // Keep the ready queue visible long enough for a contextual screenshot.
    // This page-route stub affects only browser fetches, not page.request's
    // real HTTP calls in the concurrent race below.
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByText("Reply with RACE_OK once.")).toBeVisible()
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
    await page.screenshot({ path: testInfo.outputPath("before-live-dispatch.png"), fullPage: true, animations: "disabled" })
    await page.goto("about:blank")

    const responses = await Promise.all([
      ...Array.from({ length: 8 }, () => page.request.post(`/api/chats/${chatId}/queue/dispatch`, { timeout: 180_000 })),
      page.request.get("/api/cron/prompt-queue", {
        headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
        timeout: 180_000,
      }),
    ])
    for (const response of responses) expect(response.status()).toBe(200)
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(results.slice(0, 8).filter((result) => result.status === "started").length + results[8].started).toBe(1)
    expect(results.slice(0, 8).filter((result) => result.status === "paused")).toHaveLength(0)
    expect(results[8].paused).toBe(0)
    expect(results[8].errors).toBe(0)

    const prompt = await db.queuedPrompt.findUniqueOrThrow({ where: { id: promptId } })
    expect(prompt.status).toBe("started")
    expect(await db.message.count({ where: { chatId, id: prompt.userMessageId } })).toBe(1)
    expect(await db.message.count({ where: { chatId, id: prompt.assistantMessageId } })).toBe(1)
    expect(await db.message.count({ where: { chatId } })).toBe(4)

    const stream = await page.request.get(
      `/api/agent/stream?chatId=${chatId}&assistantMessageId=${prompt.assistantMessageId}`,
      { timeout: 150_000 }
    )
    expect(stream.status()).toBe(200)
    expect(await stream.text()).toContain("event: complete")
    const completed = await db.chat.findUniqueOrThrow({ where: { id: chatId } })
    expect(completed.status).toBe("ready")
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByTestId("user-message")).toHaveCount(2)
    await expect(page.getByTestId("assistant-message")).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath("after-live-dispatch.png"), fullPage: true, animations: "disabled" })
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
    // Restore the supplied sandbox to its original stopped state. Do not
    // delete/archive it; it may belong to another local test.
    if (sandboxEligible) {
      try {
        const sandbox = await daytona.get(sandboxId)
        if (sandbox.state !== "stopped") await sandbox.stop()
      } catch (error) {
        console.warn("Could not stop the disposable race-test sandbox:", error)
      }
    }
  }
})
