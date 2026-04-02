/**
 * State Sync Tests
 *
 * Verify that UI stays in sync with server state across various scenarios.
 * These tests catch issues where the UI shows stale data or fails to update
 * after state changes.
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

const PROMPT = "Create a file called sync-test.txt with 'Sync test'. Reply 'Done'."

const test = agentTest({ count: 1 })

test.describe("state sync", () => {
  test("UI updates when agent completes", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // Wait for server to complete
    await waitForCompletionViaAPI(page, branchId)

    // UI should eventually reflect completion (not stuck on "working")
    await expectNotWorking(page)
    await expectProseContent(page)
  })

  test("content persists after page refresh", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    // Capture content before refresh
    const contentBefore = await page.locator('[class*="prose"]').last().textContent()
    expect(contentBefore?.length).toBeGreaterThan(0)

    // Refresh and verify
    await page.reload()
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    const contentAfter = await page.locator('[class*="prose"]').last().textContent()
    expect(contentAfter?.length).toBeGreaterThan(0)
  })

  test("working state persists after refresh mid-execution", async ({ page, branches, repoName }) => {
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before refresh
    await waitForExecutionStarted(page, branchId)

    // Refresh while agent is working
    await page.reload()
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Should either show working (if still running) or content (if completed)
    // Give it time to sync with server state
    await page.waitForTimeout(2000)

    // Wait for server completion then verify UI catches up
    await waitForCompletionViaAPI(page, branchId)
    await expectProseContent(page, TIMEOUT.AGENT_COMPLETE)
  })

  test("idle state correct after completion", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await waitForAgentComplete(page)

    // Verify multiple indicators of idle state
    await expectNotWorking(page)
    await expectProseContent(page)

    // Textarea should be enabled and ready for input
    const textarea = page.locator("textarea")
    await expect(textarea).toBeEnabled({ timeout: TIMEOUT.UI_READY })
  })
})
