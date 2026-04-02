/**
 * Recovery Tests
 *
 * Verify the system recovers correctly from page reloads during execution.
 * Navigation-away tests are in navigation-resilience.spec.ts.
 */
import {
  agentTest,
  navigateToRepo,
  selectBranch,
  sendMessage,
  expectAgentWorking,
  expectProseContent,
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

  test("recovers after multiple reloads", async ({ page, branches, repoName }) => {
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
})
