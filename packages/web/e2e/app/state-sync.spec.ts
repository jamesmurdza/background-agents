/**
 * State Sync Tests
 *
 * Verify that UI stays in sync with server state.
 * Refresh/reload tests are in recovery.spec.ts.
 * Post-completion content persistence is tested in single-agent.spec.ts.
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

    // Wait for execution to be created (avoids race with API polling)
    await waitForExecutionStarted(page, branchId)

    // Wait for server to complete
    await waitForCompletionViaAPI(page, branchId)

    // UI should eventually reflect completion (not stuck on "working")
    await expectNotWorking(page)
    await expectProseContent(page)
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
