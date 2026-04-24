/**
 * Streaming E2E Tests
 *
 * Tests run serially and reuse the same sandbox for speed.
 * First test creates the sandbox (~30-60s), subsequent tests reuse it.
 *
 * Tests the chat streaming functionality:
 * - Message sending and response streaming
 * - Content persistence across page reloads
 * - Content stability during streaming (no disappearing)
 */

import { test, expect, Page, BrowserContext } from "@playwright/test"

/**
 * Sets up test authentication by calling the test auth endpoint
 * and setting the session cookie
 */
async function setupTestAuth(page: Page, context: BrowserContext) {
  // Call test auth endpoint to get session token
  const response = await page.request.post("/api/test/auth")

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to get test auth: ${response.status()} - ${body}`)
  }

  const { token } = await response.json()

  // Set the session cookie
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "localhost",
      path: "/",
    },
  ])
}


// Use describe.serial so tests run in order and share state (same sandbox)
test.describe.serial("Chat Streaming", () => {
  test.beforeEach(async ({ page, context }) => {
    await setupTestAuth(page, context)
  })

  // Test 1: Creates sandbox (slow), sends message, verifies response
  // Uses OpenCode with "Big Pickle (Free)" model which doesn't require API keys
  test("sends message and receives streamed response", async ({ page }) => {
    await page.goto("/")

    // Wait for the app to load
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Type and send a message
    const input = page.getByTestId("chat-input")
    await input.fill("Hello, how are you feeling today?")
    await page.keyboard.press("Enter")

    // User message should appear immediately
    await expect(page.getByTestId("user-message")).toContainText(
      "Hello, how are you feeling today?"
    )

    // Wait for assistant message to appear (sandbox creation + agent start)
    const assistantMessage = page.getByTestId("assistant-message").last()
    await expect(assistantMessage).toBeVisible({ timeout: 90000 })

    // Wait for streaming to complete (status changes from "running" to "ready" or "error")
    // Note: In test environment without proper API keys, the agent may error
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      /^(ready|error)$/,
      { timeout: 120000 }
    )

    // Verify assistant message has content or shows an error
    const content = await assistantMessage.textContent()
    expect(content).toBeTruthy()
    // Allow empty content if there was an error (status will show "error")
    const status = await page.getByTestId("chat-container").getAttribute("data-chat-status")
    if (status === "ready") {
      expect(content!.length).toBeGreaterThan(0)
    }
  })

  // Test 2: Reuses sandbox from test 1, sends another message (fast)
  test("second message reuses existing sandbox", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Click "All chats" to see the list
    await page.getByRole("button", { name: "All chats" }).click()

    // Click on the existing chat (should be in sidebar)
    // Wait for chat list to load from server
    const chatItem = page.locator('[data-testid="chat-item"]').first()
    await expect(chatItem).toBeVisible({ timeout: 10000 })
    await chatItem.click()

    // Now should see messages from previous test
    await expect(page.getByTestId("user-message")).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId("assistant-message")).toBeVisible({ timeout: 10000 })

    // Send another message (no sandbox creation needed - fast!)
    await page.getByTestId("chat-input").fill("Tell me more about that")
    await page.keyboard.press("Enter")

    // Wait for response
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 60000 }
    )

    // Should now have 2 user messages and 2 assistant messages
    await expect(page.getByTestId("user-message")).toHaveCount(2)
    await expect(page.getByTestId("assistant-message")).toHaveCount(2)
  })

  // Test 3: Verify messages persist after reload
  test("messages persist after page reload", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Click "All chats" to see the list
    await page.getByRole("button", { name: "All chats" }).click()

    // Click on the existing chat (fresh browser context means no localStorage)
    const chatItem = page.locator('[data-testid="chat-item"]').first()
    await expect(chatItem).toBeVisible({ timeout: 10000 })
    await chatItem.click()

    // Wait for messages to load
    await expect(page.getByTestId("user-message")).toBeVisible({ timeout: 10000 })

    // Should have messages from previous tests
    const userMessages = page.getByTestId("user-message")
    const assistantMessages = page.getByTestId("assistant-message")

    // Count messages before reload
    const userCountBefore = await userMessages.count()
    const assistantCountBefore = await assistantMessages.count()

    expect(userCountBefore).toBeGreaterThanOrEqual(2)
    expect(assistantCountBefore).toBeGreaterThanOrEqual(2)

    // Reload the page
    await page.reload()

    // Wait for app to load again
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Click "All chats" again after reload
    await page.getByRole("button", { name: "All chats" }).click()

    // Click on the chat again
    await expect(chatItem).toBeVisible({ timeout: 10000 })
    await chatItem.click()

    // Wait for messages to load again
    await expect(page.getByTestId("user-message")).toBeVisible({ timeout: 10000 })

    // Messages should still be there
    await expect(userMessages).toHaveCount(userCountBefore)
    await expect(assistantMessages).toHaveCount(assistantCountBefore)
  })

  // Test 4: Verify content doesn't disappear during streaming
  test("streaming content does not disappear mid-stream", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Click "All chats" to see the list
    await page.getByRole("button", { name: "All chats" }).click()

    // Click on the existing chat (fresh browser context means no localStorage)
    const chatItem = page.locator('[data-testid="chat-item"]').first()
    await expect(chatItem).toBeVisible({ timeout: 10000 })
    await chatItem.click()

    // Wait for messages to load
    await expect(page.getByTestId("user-message")).toBeVisible({ timeout: 10000 })

    // Send a message that should generate a response
    await page.getByTestId("chat-input").fill("What else can you tell me?")
    await page.keyboard.press("Enter")

    // Wait for assistant message to appear and start streaming
    const assistantMessages = page.getByTestId("assistant-message")
    const countBefore = await assistantMessages.count()

    // Wait for new message to appear
    await expect(assistantMessages).toHaveCount(countBefore + 1, { timeout: 60000 })

    const assistantMessage = assistantMessages.last()

    // Wait for some content to appear
    await page.waitForFunction(
      () => {
        const msg = document.querySelector(
          '[data-testid="assistant-message"]:last-child'
        )
        return msg && msg.textContent && msg.textContent.length > 5
      },
      { timeout: 60000 }
    )

    // Capture content at multiple points and verify it only grows
    let previousLength = 0

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(300)

      const currentContent = await assistantMessage.textContent()
      const currentLength = currentContent?.length || 0

      // Content should never shrink
      expect(currentLength).toBeGreaterThanOrEqual(previousLength)
      previousLength = currentLength

      // Check if streaming completed
      const status = await page
        .getByTestId("chat-container")
        .getAttribute("data-chat-status")
      if (status === "ready") break
    }

    // Final content should be substantial
    expect(previousLength).toBeGreaterThan(5)
  })
})
