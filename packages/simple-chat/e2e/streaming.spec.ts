/**
 * Streaming E2E Tests
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

test.describe("Chat Streaming", () => {
  test.beforeEach(async ({ page, context }) => {
    await setupTestAuth(page, context)
  })

  test("sends message and receives streamed response", async ({ page }) => {
    await page.goto("/")

    // Wait for the app to load
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Type and send a message (use Eliza-friendly prompt)
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

    // Wait for streaming to complete (status changes from "running" to "ready")
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 120000 }
    )

    // Verify assistant message has content
    const content = await assistantMessage.textContent()
    expect(content).toBeTruthy()
    expect(content!.length).toBeGreaterThan(0)
  })

  test("messages persist after page reload", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Send a message
    const testMessage = `Test message ${Date.now()}`
    await page.getByTestId("chat-input").fill(testMessage)
    await page.keyboard.press("Enter")

    // Wait for user message
    await expect(page.getByTestId("user-message")).toContainText(testMessage)

    // Wait for assistant response to complete
    const assistantMessage = page.getByTestId("assistant-message").last()
    await expect(assistantMessage).toBeVisible({ timeout: 90000 })

    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 120000 }
    )

    // Capture the response content
    const responseContent = await assistantMessage.textContent()
    expect(responseContent).toBeTruthy()

    // Reload the page
    await page.reload()

    // Wait for app to load again
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Messages should still be visible
    await expect(page.getByTestId("user-message")).toContainText(testMessage)
    await expect(page.getByTestId("assistant-message").last()).toContainText(
      responseContent!.slice(0, 50) // Check first 50 chars to avoid whitespace issues
    )
  })

  test("streaming content does not disappear mid-stream", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Send a message that should generate a longer response
    await page.getByTestId("chat-input").fill("Tell me about yourself in detail")
    await page.keyboard.press("Enter")

    // Wait for assistant message to appear and start streaming
    const assistantMessage = page.getByTestId("assistant-message").last()
    await expect(assistantMessage).toBeVisible({ timeout: 90000 })

    // Wait for some content to appear
    await page.waitForFunction(
      () => {
        const msg = document.querySelector(
          '[data-testid="assistant-message"]:last-child'
        )
        return msg && msg.textContent && msg.textContent.length > 10
      },
      { timeout: 60000 }
    )

    // Capture content at multiple points and verify it only grows
    let previousLength = 0

    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(500)

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
    expect(previousLength).toBeGreaterThan(10)
  })

  test("multiple messages in conversation", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Send first message
    await page.getByTestId("chat-input").fill("Hello")
    await page.keyboard.press("Enter")

    // Wait for first response
    await expect(page.getByTestId("assistant-message")).toBeVisible({
      timeout: 90000,
    })
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 120000 }
    )

    // Send second message
    await page.getByTestId("chat-input").fill("Tell me more")
    await page.keyboard.press("Enter")

    // Wait for second response
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 120000 }
    )

    // Should have 2 user messages and 2 assistant messages
    await expect(page.getByTestId("user-message")).toHaveCount(2)
    await expect(page.getByTestId("assistant-message")).toHaveCount(2)

    // Reload and verify all messages persist
    await page.reload()
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    await expect(page.getByTestId("user-message")).toHaveCount(2)
    await expect(page.getByTestId("assistant-message")).toHaveCount(2)
  })

  test("handles sandbox creation for new chat", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })

    // Send a message
    await page.getByTestId("chat-input").fill("Create a test file")
    await page.keyboard.press("Enter")

    // Should see "creating" status briefly (sandbox being created)
    // Note: This might be too fast to catch reliably, so we check for either creating or running
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      /creating|running/,
      { timeout: 30000 }
    )

    // Eventually should complete
    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      "ready",
      { timeout: 120000 }
    )

    // Should have a response
    await expect(page.getByTestId("assistant-message")).toBeVisible()
  })
})
