/**
 * Multi-window SSE streaming tests.
 *
 * Exercises behavior that only matters when more than one window/tab is open
 * in the same browser. Both pages live in the same Playwright BrowserContext
 * so that any cross-tab coordination (BroadcastChannel, localStorage, etc.)
 * can connect them — the same way two real browser windows would.
 *
 * All tests use the local Eliza agent (no API keys required).
 */

import { test, expect, type Request } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

test.describe.serial("Multi-window streaming", () => {
  /**
   * Leader election: two windows on the same browser should NOT each open
   * their own SSE connection to a running chat. Exactly one window opens the
   * `/api/agent/stream` EventSource (the "leader"); the other receives updates
   * via BroadcastChannel (or similar coordination in the stream store).
   *
   * Current behavior: each window opens its own EventSource, causing N×
   * sandbox load and N× concurrent auto-push on completion (the latter
   * intermittently produces a spurious "Push failed — force push?" message).
   *
   * Marked `test.fixme` until leader election is implemented in
   * `packages/web/lib/stores/stream-store.ts`. Remove the fixme when wired up
   * — this test is the contract for the fix.
   */
  test.fixme(
    "opens only one EventSource across two same-browser windows",
    async ({ browser }) => {
      const context = await browser.newContext()

      // Authenticate once on the context, then pin Eliza as the default agent
      // so the test doesn't depend on any API keys.
      const setupPage = await context.newPage()
      await setupTestAuth(setupPage, context)
      await setDefaultAgentEliza(setupPage)
      await setupPage.close()

      // Open two pages in the SAME context — BroadcastChannel is per-context,
      // so this mirrors a user with two real browser windows open.
      const [pageA, pageB] = await Promise.all([
        context.newPage(),
        context.newPage(),
      ])

      // Count GET requests to the SSE endpoint across BOTH pages. The
      // leader-election invariant is that this stays at exactly 1.
      let streamConnections = 0
      const countStream = (req: Request) => {
        if (req.method() === "GET" && req.url().includes("/api/agent/stream")) {
          streamConnections++
        }
      }
      pageA.on("request", countStream)
      pageB.on("request", countStream)

      // Page A: load the app, send a message.
      await pageA.goto("/")
      await expect(pageA.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })
      await expect(pageA.getByText("test@playwright.local")).toBeVisible({
        timeout: 10000,
      })

      const inputA = pageA.getByTestId("chat-input")
      await inputA.click()
      await inputA.fill("Hello?")
      await inputA.press("Enter")

      // Wait until the chat has reached a state where SSE is in play
      // (sandbox created and agent running, or already finished).
      await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
        "data-chat-status",
        /^(running|ready|error)$/,
        { timeout: 90000 }
      )

      // Page B: load the app. Its resume-streaming effect sees a running chat
      // and *would* (in current code) open its own EventSource. With leader
      // election, it must NOT — Page A is already the leader for this chat.
      await pageB.goto("/")
      await expect(pageB.getByTestId("chat-input")).toBeVisible({ timeout: 15000 })

      // Wait for Page A to fully complete so we capture every SSE attempt
      // either page would have made (including any post-reconnect retries).
      await expect(pageA.getByTestId("chat-container")).toHaveAttribute(
        "data-chat-status",
        /^(ready|error)$/,
        { timeout: 120000 }
      )

      // Brief settle window in case Page B's resume effect lags behind
      // hydration; an incorrectly-implemented leader election would race
      // here and we want to catch it.
      await pageB.waitForTimeout(2000)

      // Invariant: exactly one EventSource was opened across the whole browser.
      expect(streamConnections).toBe(1)

      await context.close()
    }
  )
})
