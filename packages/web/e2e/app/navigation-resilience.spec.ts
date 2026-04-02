/**
 * Navigation Resilience Tests
 *
 * Verify that state survives navigation away from and back to the chat.
 * These tests catch issues like empty bubbles after visiting settings/admin.
 */
import {
  agentTest,
  navigateToRepo,
  selectBranch,
  sendMessage,
  expectAgentWorking,
  waitForAgentComplete,
  expectProseContent,
  expectNotWorking,
  waitForCompletionViaAPI,
  waitForExecutionStarted,
  expect,
} from "../fixtures/agent-fixture"
import { TIMEOUT } from "../fixtures/timeouts"

const PROMPT = "Create nav-test.txt with 'Navigation test'. Reply 'Done'."

const test = agentTest({ count: 2, singleRepo: true })

test.describe("navigation resilience", () => {
  test("content preserved after visiting admin page", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    // Capture content
    const contentBefore = await page.locator('[class*="prose"]').last().textContent()
    expect(contentBefore?.length).toBeGreaterThan(0)

    // Navigate to admin
    await page.goto("/admin")
    await page.waitForTimeout(1000)

    // Return to chat
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Verify content is intact
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)

    const contentAfter = await page.locator('[class*="prose"]').last().textContent()
    expect(contentAfter?.length, "content should not be empty after returning from admin").toBeGreaterThan(0)
  })

  test("content preserved after opening and closing settings modal", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    const contentBefore = await page.locator('[class*="prose"]').last().textContent()

    // Open settings modal (look for settings button/icon)
    const settingsButton = page.locator('button:has-text("Settings"), [aria-label*="settings"], [aria-label*="Settings"]').first()
    if (await settingsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await settingsButton.click()
      await page.waitForTimeout(1000)

      // Close modal (ESC or close button)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(500)
    }

    // Verify content still intact
    await expectProseContent(page)
    const contentAfter = await page.locator('[class*="prose"]').last().textContent()
    expect(contentAfter?.length).toBeGreaterThan(0)
  })

  test("content preserved after switching branches", async ({ page, branches, repoName }) => {
    // Send message on branch 0
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    const branch0Content = await page.locator('[class*="prose"]').last().textContent()

    // Switch to branch 1
    await selectBranch(page, 1)
    await page.waitForTimeout(1000)

    // Switch back to branch 0
    await selectBranch(page, 0)
    await page.waitForTimeout(1000)

    // Verify branch 0 content is intact
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    const contentAfter = await page.locator('[class*="prose"]').last().textContent()
    expect(contentAfter?.length, "branch content should persist after switching").toBeGreaterThan(0)
  })

  test("agent continues while navigated away", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before navigating away
    await waitForExecutionStarted(page, branchId)

    // Navigate away while agent is working
    await page.goto("/admin")
    await page.waitForTimeout(2000)

    // Wait for completion via API (agent runs server-side)
    await waitForCompletionViaAPI(page, branchId)

    // Return to chat
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Should show completed content, not empty
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)
  })

  test("rapid branch switching preserves state", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    // Rapidly switch branches
    for (let i = 0; i < 5; i++) {
      await selectBranch(page, 1)
      await page.waitForTimeout(200)
      await selectBranch(page, 0)
      await page.waitForTimeout(200)
    }

    // Content should still be intact
    await expectProseContent(page)
    await expectNotWorking(page)
  })
})
