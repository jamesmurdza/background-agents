import { test, expect } from "@playwright/test"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { claimNextPrompt } from "../lib/server/prompt-queue"
import { setupTestAuth } from "./helpers"

test("a text send in an existing ready chat is saved in the server queue before dispatch", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.message.create({
      data: { chatId, role: "user", content: "Earlier turn", timestamp: BigInt(Date.now()) },
    })

    let directSends = 0
    await page.route(`**/api/chats/${chatId}/messages`, (route) => {
      if (route.request().method() === "POST") directSends++
      return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Chat is busy"}' })
    })
    // Keep the queued row pending so we can inspect it without starting Daytona.
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )

    await page.goto(`/chat/${chatId}`)
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
    const prompt = "Keep this prompt across a refresh"
    const input = page.getByTestId("chat-input")
    await input.fill(prompt)
    await input.press("Enter")

    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, content: prompt, status: "queued" } })).toBe(1)
    expect(directSends).toBe(0)
    await page.reload()
    await expect(page.getByText(prompt)).toBeVisible()
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("rapid sends from one tab keep their order when the first enqueue is delayed", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.message.create({
      data: { chatId, role: "user", content: "Earlier turn", timestamp: BigInt(Date.now()) },
    })
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )
    await page.route(`**/api/chats/${chatId}/queue`, async (route) => {
      if (route.request().method() === "POST" && route.request().postDataJSON()?.content === "First queued prompt") {
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      await route.continue()
    })

    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("First queued prompt")
    await input.press("Enter")
    await input.fill("Second queued prompt")
    await input.press("Enter")

    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId } })).toBe(2)
    const rows = await db.queuedPrompt.findMany({ where: { chatId }, orderBy: { position: "asc" } })
    expect(rows.map((row) => row.content)).toEqual(["First queued prompt", "Second queued prompt"])
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a failed first enqueue cannot let the next prompt overtake it", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.message.create({
      data: { chatId, role: "user", content: "Earlier turn", timestamp: BigInt(Date.now()) },
    })
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )
    let failedOnce = false
    await page.route(`**/api/chats/${chatId}/queue`, (route) => {
      if (route.request().method() === "POST" &&
          route.request().postDataJSON()?.content === "First after failure" && !failedOnce) {
        failedOnce = true
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Temporary failure"}' })
      }
      return route.continue()
    })

    await page.goto(`/chat/${chatId}`)
    const input = page.getByTestId("chat-input")
    await input.fill("First after failure")
    await input.press("Enter")
    await input.fill("Second after failure")
    await input.press("Enter")

    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId } })).toBe(2)
    const rows = await db.queuedPrompt.findMany({ where: { chatId }, orderBy: { position: "asc" } })
    expect(rows.map((row) => row.content)).toEqual(["First after failure", "Second after failure"])
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a busy rejection of a direct send restores the unsent draft", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    // An empty chat's first send still uses the direct path for creation and naming.
    await page.route(`**/api/chats/${chatId}/messages`, (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Chat is busy"}' })
    )

    await page.goto(`/chat/${chatId}`)
    const prompt = "Do not lose this first prompt"
    const input = page.getByTestId("chat-input")
    await input.fill(prompt)
    await input.press("Enter")

    await expect(input).toHaveValue(prompt)
    await expect(page.getByText("Error: Chat is busy")).toHaveCount(0)
    expect(await db.message.count({ where: { chatId, content: prompt } })).toBe(0)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("an open chat wakes queued dispatch when its turn completes", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string

    const assistantMessageId = crypto.randomUUID()

    await db.chat.update({
      where: { id: chatId },
      data: { sandboxId: "synthetic-sandbox", backgroundSessionId: "synthetic-turn", activeAssistantMessageId: assistantMessageId },
    })
    await db.message.createMany({ data: [
      { chatId, role: "user", content: "First prompt", timestamp: BigInt(Date.now()) },
      { id: assistantMessageId, chatId, role: "assistant", content: "", timestamp: BigInt(Date.now() + 1) },
    ] })
    const queued = await page.request.post(`/api/chats/${chatId}/queue`, {
      data: { clientId: crypto.randomUUID(), content: "Second prompt", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(queued.status()).toBe(201)

    // Control the finish event without waiting for a Daytona agent or the cron.
    // The DB becomes ready before the event, matching the real SSE finalizer.
    let completionSent = false
    await page.route("**/api/agent/stream?*", async (route) => {
      await db.chat.update({
        where: { id: chatId! },
        data: { status: "ready", backgroundSessionId: null, activeAssistantMessageId: null },
      })
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: complete\ndata: {"status":"completed","sessionId":"synthetic-session","cursor":0}\n\n',
      })
      completionSent = true
    })
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )

    let wakeRequests = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/api/chats/${chatId}/queue/dispatch`)) {
        wakeRequests++
      }
    })
    await page.goto(`/chat/${chatId}`, { waitUntil: "domcontentloaded" })
    await expect.poll(() => completionSent).toBe(true)
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
    await expect.poll(() => wakeRequests, { timeout: 10_000 }).toBe(1)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a stream update changes its assistant message, not a newer queued user message", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    const assistantMessageId = crypto.randomUUID()
    const now = BigInt(Date.now())
    await db.chat.update({
      where: { id: chatId },
      data: { sandboxId: "synthetic-sandbox", backgroundSessionId: "synthetic-turn", activeAssistantMessageId: assistantMessageId },
    })
    await db.message.createMany({ data: [
      { chatId, role: "user", content: "say 4", timestamp: now },
      { id: assistantMessageId, chatId, role: "assistant", content: "", timestamp: now + 1n },
      { chatId, role: "user", content: "say 5", timestamp: now + 2n },
    ] })

    await page.route("**/api/agent/stream?*", async (route) => {
      const url = new URL(route.request().url())
      expect(url.searchParams.get("assistantMessageId")).toBe(assistantMessageId)
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: update\ndata: {"status":"running","content":"4","toolCalls":[],"contentBlocks":[],"cursor":1}\n\n',
      })
    })
    await page.goto(`/chat/${chatId}`)
    await expect(page.locator('[data-role="assistant"]')).toHaveText("4")
    await expect(page.locator('[data-role="user"]')).toHaveText(["say 4", "say 5"])
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("a delayed Stop for the previous turn cannot pause or cancel its successor", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.chat.update({
      where: { id: chatId },
      data: { sandboxId: "synthetic-sandbox", backgroundSessionId: "turn-B", activeAssistantMessageId: "assistant-B", status: "running" },
    })
    const stop = await page.request.post("/api/agent/stop", {
      data: { chatId, backgroundSessionId: "turn-A", assistantMessageId: "assistant-A" },
    })
    expect(stop.status()).toBe(409)
    const chat = await db.chat.findUniqueOrThrow({ where: { id: chatId } })
    expect(chat.status).toBe("running")
    expect(chat.backgroundSessionId).toBe("turn-B")
    expect(chat.activeAssistantMessageId).toBe("assistant-B")
    expect(chat.queuePaused).toBe(false)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("enqueue wakes the queue if the turn finished just before the prompt was saved", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "running", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.message.create({
      data: { chatId, role: "user", content: "First prompt", timestamp: BigInt(Date.now()) },
    })

    let wakeRequests = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/api/chats/${chatId}/queue/dispatch`)) {
        wakeRequests++
      }
    })
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "running")

    // The browser still sees a running turn when it chooses to enqueue. The
    // backend finalizes immediately before the queued POST reaches the server.
    await page.route(`**/api/chats/${chatId}/queue`, async (route) => {
      if (route.request().method() === "POST") {
        await db.chat.update({ where: { id: chatId! }, data: { status: "ready" } })
      }
      await route.continue()
    })
    const text = "Prompt saved after completion"
    const input = page.getByTestId("chat-input")
    await input.fill(text)
    await input.press("Enter")
    await expect.poll(async () => db.queuedPrompt.count({ where: { chatId, content: text } })).toBe(1)
    await expect.poll(() => wakeRequests).toBeGreaterThanOrEqual(1)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("opening a chat wakes an already-ready persisted queue", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string
    await db.message.create({
      data: { chatId, role: "user", content: "Completed first prompt", timestamp: BigInt(Date.now()) },
    })
    const enqueue = await page.request.post(`/api/chats/${chatId}/queue`, {
      data: { clientId: crypto.randomUUID(), content: "Persisted pending prompt", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(enqueue.status()).toBe(201)

    let wakeRequests = 0
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/api/chats/${chatId}/queue/dispatch`)) {
        wakeRequests++
      }
    })
    await page.route(`**/api/chats/${chatId}/queue/dispatch`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"skipped"}' })
    )
    await page.goto(`/chat/${chatId}`)
    await expect(page.getByTestId("chat-container")).toHaveAttribute("data-chat-status", "ready")
    await expect.poll(() => wakeRequests).toBeGreaterThanOrEqual(1)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("concurrent queue claims and a normal send cannot both take a ready chat", async ({ page, context, browser }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let chatId: string | undefined

  try {
    const create = await page.request.post("/api/chats", {
      data: { repo: "__new__", status: "ready", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(create.ok()).toBe(true)
    chatId = (await create.json()).id as string

    const enqueue = await page.request.post(`/api/chats/${chatId}/queue`, {
      data: { clientId: crypto.randomUUID(), content: "Run this only once", agent: "eliza", model: "eliza-classic-1.0" },
    })
    expect(enqueue.status()).toBe(201)
    const promptId = (await enqueue.json()).queuedMessage.id as string

    const anonymous = await browser.newContext()
    try {
      const denied = await anonymous.request.post(`http://localhost:4000/api/chats/${chatId}/queue/dispatch`)
      expect(denied.status()).toBe(401)
    } finally {
      await anonymous.close()
    }

    // All wake-up sources use claimNextPrompt. The real database row lock must
    // allow only one winner, even when several requests arrive together.
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimNextPrompt(chatId!)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)?.id).toBe(promptId)
    expect((await db.queuedPrompt.findUniqueOrThrow({ where: { id: promptId } })).status).toBe("dispatching")

    // Reset the test row to check the other race: a direct user send and queue
    // wake-up both see a ready chat at the same instant.
    await db.chat.update({ where: { id: chatId }, data: { status: "ready", queueDispatchId: null } })
    await db.queuedPrompt.update({ where: { id: promptId }, data: { status: "queued", claimedAt: null } })
    const [queueClaim, directSend] = await Promise.all([
      claimNextPrompt(chatId),
      db.chat.updateMany({
        where: { id: chatId, status: "ready", backgroundSessionId: null, queueDispatchId: null },
        data: { status: "creating" },
      }),
    ])
    expect(Number(!!queueClaim) + directSend.count).toBe(1)
    const chat = await db.chat.findUniqueOrThrow({ where: { id: chatId } })
    expect(chat.status).toBe("creating")
    expect(chat.queueDispatchId).toBe(queueClaim ? promptId : null)

    // An authenticated wake-up must not claim a paused queue.
    await db.chat.update({ where: { id: chatId }, data: { status: "ready", queueDispatchId: null, queuePaused: true } })
    await db.queuedPrompt.update({ where: { id: promptId }, data: { status: "queued", claimedAt: null } })
    const paused = await page.request.post(`/api/chats/${chatId}/queue/dispatch`)
    expect(paused.status()).toBe(200)
    expect((await paused.json()).status).toBe("skipped")
    expect((await db.queuedPrompt.findUniqueOrThrow({ where: { id: promptId } })).status).toBe("queued")

    const cron = await page.request.get("/api/cron/prompt-queue", {
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
    })
    expect(cron.status()).toBe(200)
    expect((await cron.json()).started).toBe(0)
  } finally {
    if (chatId) await db.chat.deleteMany({ where: { id: chatId } })
    await db.$disconnect()
  }
})

test("simultaneous browser and cron HTTP requests dispatch a prompt at most once", async ({ page, context }) => {
  await setupTestAuth(page, context)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  const chatIds: string[] = []

  try {
    // A paid shared-pool model with zero credits is rejected before Daytona.
    // That lets the real HTTP routes race through claim + send preflight
    // without provisioning a sandbox or charging an external provider.
    const user = await db.user.findUniqueOrThrow({ where: { email: "test@playwright.local" } })
    expect(user.creditBalanceMicroUsd).toBe(0n)
    expect(user.credentials).toBeNull()

    for (let round = 0; round < 3; round++) {
      const create = await page.request.post("/api/chats", {
        data: { repo: "__new__", status: "ready", agent: "opencode", model: "opencode/claude-sonnet-4-5" },
      })
      expect(create.ok()).toBe(true)
      const chatId = (await create.json()).id as string
      chatIds.push(chatId)
      const enqueue = await page.request.post(`/api/chats/${chatId}/queue`, {
        data: {
          clientId: crypto.randomUUID(), content: `Race attempt ${round}`,
          agent: "opencode", model: "opencode/claude-sonnet-4-5",
        },
      })
      expect(enqueue.status()).toBe(201)
      const promptId = (await enqueue.json()).queuedMessage.id as string

      const requests = await Promise.all([
        ...Array.from({ length: 8 }, () => page.request.post(`/api/chats/${chatId}/queue/dispatch`)),
        page.request.get("/api/cron/prompt-queue", {
          headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
        }),
      ])
      for (const response of requests) expect(response.status()).toBe(200)
      const results = await Promise.all(requests.map((response) => response.json()))
      const browserPaused = results.slice(0, 8).filter((result) => result.status === "paused").length
      const cronPaused = results[8].paused as number
      expect(browserPaused + cronPaused).toBe(1)
      expect(results.slice(0, 8).filter((result) => result.status === "started")).toHaveLength(0)
      expect(results[8].started).toBe(0)

      const prompt = await db.queuedPrompt.findUniqueOrThrow({ where: { id: promptId } })
      const chat = await db.chat.findUniqueOrThrow({ where: { id: chatId } })
      expect(prompt.status).toBe("queued")
      expect(prompt.lastError).toBeTruthy()
      expect(chat.queuePaused).toBe(true)
      expect(chat.queueDispatchId).toBeNull()
      expect(await db.message.count({ where: { chatId } })).toBe(0)
    }
  } finally {
    await db.chat.deleteMany({ where: { id: { in: chatIds } } })
    await db.$disconnect()
  }
})
