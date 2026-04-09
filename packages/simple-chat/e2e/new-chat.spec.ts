import { test, expect } from "@playwright/test"

test.describe("New Chat Flow", () => {
  test("should create a new chat and send a prompt without error", async ({ page }) => {
    // Navigate to the app
    await page.goto("/")

    // Should see the welcome screen with "Background Agents" title
    await expect(page.locator("h1")).toContainText("Background Agents")
    await expect(page.locator("h2")).toContainText("Welcome to Background Agents")

    // Click "New Chat" button
    await page.click('button:has-text("New Chat")')

    // Should now see the new chat view with "What would you like to build?"
    await expect(page.locator("h2")).toContainText("What would you like to build?")

    // Should see "New Repository" in the chat input
    await expect(page.locator("text=New Repository")).toBeVisible()

    // Type a simple prompt in the textarea
    const textarea = page.locator('textarea[placeholder="Message..."]')
    await expect(textarea).toBeVisible()
    await textarea.fill("Create a simple hello world file")

    // Click the send button
    const sendButton = page.locator('button:has(svg.lucide-send)')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()

    // Should see the user message appear
    await expect(page.locator("text=Create a simple hello world file")).toBeVisible()

    // Should see "Creating sandbox..." status (may be quick)
    // Wait for either creating status or running status
    await expect(
      page.locator("text=Creating sandbox...").or(page.locator("text=Agent working..."))
    ).toBeVisible({ timeout: 30_000 })

    // Wait for agent to start working (sandbox created successfully)
    await expect(page.locator("text=Agent working...")).toBeVisible({ timeout: 120_000 })

    // Wait for agent to complete - the "Agent working..." should disappear
    await expect(page.locator("text=Agent working...")).not.toBeVisible({ timeout: 180_000 })

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

    // Should see welcome message
    await expect(page.locator("h2")).toContainText("Welcome to Background Agents")

    // Check for the welcome text (use first() to handle multiple matches)
    await expect(page.getByText("Click \"New Chat\" to start").first()).toBeVisible()

    // New Chat button should be visible
    await expect(page.locator('button:has-text("New Chat")')).toBeVisible()
  })

  test("should create new chat with New Repository selected by default", async ({ page }) => {
    await page.goto("/")

    // Click New Chat
    await page.click('button:has-text("New Chat")')

    // Should show "New Repository" selector
    await expect(page.locator("text=New Repository")).toBeVisible()

    // The dropdown chevron should be visible (indicating it can be changed)
    await expect(page.locator('button:has-text("New Repository") svg')).toBeVisible()
  })
})
