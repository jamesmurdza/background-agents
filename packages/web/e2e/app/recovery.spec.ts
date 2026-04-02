/**
 * Recovery Tests
 *
 * Verify the system recovers correctly from interruptions.
 * These tests catch issues with polling, reconnection, and state recovery.
 */
import {
  agentTest,
  navigateToRepo,
  selectBranch,
  sendMessage,
  expectAgentWorking,
  expectProseContent,
  expectNotWorking,
  waitForCompletionViaAPI,
  waitForExecutionStarted,
  expect,
} from "../fixtures/agent-fixture"
import { TIMEOUT } from "../fixtures/timeouts"

const PROMPT = "Create recovery-test.txt with 'Recovery test'. Reply 'Done'."

const test = agentTest({ count: 1 })

test.describe("recovery", () => {
  test("recovers after reload mid-stream", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before reload
    // Otherwise reload can race with message creation
    await waitForExecutionStarted(page, branchId)

    // Reload while streaming
    await page.reload()

    // Navigate back
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Wait for server to complete
    await waitForCompletionViaAPI(page, branchId)

    // UI should show content (not empty, not stuck on working)
    await expectProseContent(page, TIMEOUT.AGENT_COMPLETE)

    // Eventually should show not working
    await expect(page.getByText("Agent is working...")).toBeHidden({
      timeout: 60_000,
    })
  })

  test("recovers after navigating away mid-stream", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before navigating away
    await waitForExecutionStarted(page, branchId)

    // Navigate to a different page
    await page.goto("/admin")
    await page.waitForTimeout(1000)

    // Agent continues server-side
    await waitForCompletionViaAPI(page, branchId)

    // Navigate back
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Should show completed content
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)
  })

  test("shows correct state after multiple reloads", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)

    // CRITICAL: Wait for execution record to exist before any reload
    await waitForExecutionStarted(page, branchId)

    // Multiple reloads during execution
    await page.waitForTimeout(1000)
    await page.reload()
    await page.waitForTimeout(500)
    await page.reload()
    await page.waitForTimeout(500)

    // Navigate back
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Wait for completion
    await waitForCompletionViaAPI(page, branchId)

    // Verify correct final state
    await expectProseContent(page, TIMEOUT.AGENT_COMPLETE)
  })

  test("polling resumes after tab becomes visible", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before navigating away
    await waitForExecutionStarted(page, branchId)

    // Navigate to a different page (not about:blank which breaks API access)
    await page.goto("/admin")
    await page.waitForTimeout(2000)

    // Agent continues server-side - wait for completion
    await waitForCompletionViaAPI(page, branchId)

    // Come back
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Should reflect completed state
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)
  })

  test("error state renders correctly", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Send a message that should complete (we can't easily force an error)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // Wait for completion - this should succeed
    const { branchId } = branches[0]
    await waitForCompletionViaAPI(page, branchId)

    // After completion, we should have content and not be working
    await expectProseContent(page)
    await expectNotWorking(page)

    // No empty bubbles
    const proseBlocks = page.locator('[class*="prose"]')
    const count = await proseBlocks.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const text = await proseBlocks.nth(i).textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }
  })
})
