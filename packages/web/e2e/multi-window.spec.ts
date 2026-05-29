/**
 * Multi-window SSE streaming tests.
 *
 * Two pages share one Playwright BrowserContext so cross-tab coordination
 * (BroadcastChannel, localStorage, …) connects them — same as two real
 * browser windows. All tests use the local Eliza agent (no API keys).
 */

import { test, expect, type Request, type Route } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

test.describe.serial("Multi-window streaming", () => {
  /**
   * Regression test for fix #2 — resume-streaming effect ordering bug.
   *
   * Before the fix: useChatWithSync's resume effect had deps
   * [isHydrated, runningChatsKey, startStreaming] where runningChatsKey
   * was derived from id+bgId+sbxId only. The effect fires when chats
   * arrive — at which point chat.messages is still empty (the list
   * endpoint doesn't include messages; they load in a separate effect).
   * lastAssistantMsg is therefore undefined, the effect skips, and
   * runningChatsKey doesn't change when messages later arrive, so the
   * effect never re-runs. Net result: pageB silently fails to attach.
   *
   * After the fix: runningChatsKey includes the last assistant message
   * id, so the key invalidates the moment a streamable assistant
   * placeholder appears on the chat — and the resume effect refires
   * with messages present.
   *
   * Test setup: pageA's SSE is intercepted with a never-responding
   * route handler so pageA's chat stays "running" indefinitely. pageB
   * is left un-intercepted so its EventSource actually opens against
   * the server (we just need page.on("request") to see it; the connection
   * itself may close quickly when the server sends `complete`).
   *
   * We assert via `expect.poll` on the request counter rather than
   * `page.waitForRequest`, because waitForRequest is racy when the
   * EventSource opens and closes very quickly (the server-side SSE
   * loop on pageB finalizes the long-finished agent process almost
   * immediately and sends `complete`).
   */
  test("pageB attaches its own EventSource after joining a running chat", async ({
    browser,
  }) => {
    const context = await browser.newContext()

    const setupPage = await context.newPage()
    await setupTestAuth(setupPage, context)
    await setDefaultAgentEliza(setupPage)
    await setupPage.close()

    const [pageA, pageB] = await Promise.all([
      context.newPage(),
      context.newPage(),
    ])

    // Hang pageA's SSE so the DB chat row stays "running" indefinitely
    // (no client polls the server to finalize it). pageB is *not* hung:
    // we want its EventSource attempt to actually go out so page.on("request")
    // sees it.
    await pageA.route("**/api/agent/stream**", async (_route: Route) => {
      await new Promise(() => {
        /* never resolves */
      })
    })

    // Count GET requests to /api/agent/stream across both pages. The
    // listener fires synchronously when the EventSource opens, even if
    // the connection closes immediately afterward.
    let streamConnections = 0
    const countStream = (req: Request) => {
      if (req.method() === "GET" && req.url().includes("/api/agent/stream")) {
        streamConnections++
      }
    }
    pageA.on("request", countStream)
    pageB.on("request", countStream)

    // pageA: load and send a message.
    await pageA.goto("/")
    await expect(pageA.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })
    await expect(pageA.getByText("test@playwright.local")).toBeVisible({
      timeout: 10000,
    })

    const inputA = pageA.getByTestId("chat-input")
    await inputA.click()
    await inputA.fill("Hello?")
    await inputA.press("Enter")

    // Wait until pageA's chat is in "running" state (sandbox + agent
    // session created server-side; pageA's SSE is hung but the messages
    // POST already committed status=running to the DB).
    await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "running",
      { timeout: 120000 }
    )

    // pageA should have made exactly one SSE request by now.
    await expect.poll(() => streamConnections, { timeout: 5000 }).toBe(1)

    // pageB: load, click into the same chat to select it. This sets
    // pageB's currentChatId, triggers loadMessages, and (post-fix) the
    // resume effect refires with messages populated, opening pageB's
    // own EventSource.
    await pageB.goto("/")
    await expect(pageB.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })

    const chatItemB = pageB.locator('[data-testid="chat-item"]').first()
    await expect(chatItemB).toBeVisible({ timeout: 30000 })
    await chatItemB.click()

    // Post-fix invariant: pageB attaches via its own EventSource. The
    // count goes from 1 to 2. Pre-fix this stays at 1 forever.
    await expect
      .poll(() => streamConnections, {
        message:
          "pageB should attach via its own EventSource once messages are loaded (fix #2)",
        timeout: 15000,
      })
      .toBe(2)

    await context.close()
  })
})
