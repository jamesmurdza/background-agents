import { test, expect } from "@playwright/test"

test.describe("New Chat Flow", () => {
  test("should create a new chat and send a prompt without error", async ({ page }) => {
    // Navigate to the app
    await page.goto("/")

    // Should see the welcome screen with "Background Agents" title
    await expect(page.locator("h1")).toContainText("Background Agents")

    // New chat view shows immediately - "What would you like to build?"
    await expect(page.locator("h2")).toContainText("What would you like to build?")

    // Should see "New Repository" in the chat input
    await expect(page.locator("text=New Repository")).toBeVisible()

    // Type a simple prompt in the textarea
    const textarea = page.locator('textarea[placeholder="Message..."]')
    await expect(textarea).toBeVisible()
    await textarea.fill("Create a simple hello world file")

    // Click the send button (arrow up icon appears after text is entered)
    const sendButton = page.locator('button:has(svg.lucide-arrow-up)')
    await expect(sendButton).toBeVisible()
    await sendButton.click()

    // Should see the user message appear
    await expect(page.locator("text=Create a simple hello world file")).toBeVisible()

    // Wait for the agent to start working - look for the stop button (square icon)
    // or for loading state in placeholder
    await expect(
      page.locator('textarea[placeholder="Creating sandbox..."]').or(
        page.locator('textarea[placeholder="Agent is working..."]')
      )
    ).toBeVisible({ timeout: 30_000 })

    // Wait for agent to complete - placeholder should return to "Message..."
    await expect(page.locator('textarea[placeholder="Message..."]')).toBeVisible({ timeout: 180_000 })

    // Verify no error messages appeared
    const errorTexts = ["Failed to create sandbox", "Missing required field"]
    for (const errorText of errorTexts) {
      await expect(page.locator(`text=${errorText}`)).not.toBeVisible()
    }

    // Verify the assistant gave a response (the response should mention creating the file)
    // The assistant response should be visible in the chat (use first() to handle multiple matches)
    await expect(page.locator("p").filter({ hasText: /created/i }).first()).toBeVisible()
  })

  test("should show the welcome screen on initial load", async ({ page }) => {
    await page.goto("/")

    // Should see Background Agents title
    await expect(page.locator("h1")).toContainText("Background Agents")

    // Should see "What would you like to build?" for new chat
    await expect(page.locator("h2")).toContainText("What would you like to build?")

    // Should see the sandbox info text (below the input)
    await expect(page.locator("text=Agents are isolated in Daytona sandboxes and tied to Git branches")).toBeVisible()

    // Should see agent and model selectors
    await expect(page.locator("text=OpenCode")).toBeVisible()
    await expect(page.locator("text=Claude Sonnet")).toBeVisible()

    // Should see New Chat button in sidebar
    await expect(page.locator('button:has-text("New Chat")')).toBeVisible()
  })

  test("should have New Repository selected by default", async ({ page }) => {
    await page.goto("/")

    // Should show "New Repository" selector
    await expect(page.locator("text=New Repository")).toBeVisible()

    // The dropdown chevron should be visible (indicating it can be changed)
    await expect(page.locator('button:has-text("New Repository") svg')).toBeVisible()
  })
})
