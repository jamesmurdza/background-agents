/**
 * Diagnostics for agent stream / polling bugs (stuck "working", missed content, etc.).
 *
 * Run: `npm run test:e2e -- e2e/diagnostics/stream-bug-repro.spec.ts`
 *
 * On failure, open the test's `stream-instrumentation.txt` attachment (trace also if enabled).
 */
import {
  agentTest,
  navigateToRepo,
  selectBranch,
  sendMessage,
  expectAgentWorking,
  waitForAgentComplete,
  waitForCompletionViaAPI,
  waitForExecutionStarted,
  expectProseContent,
  expect,
} from "../fixtures/agent-fixture"
import { attachStreamInstrumentation } from "../fixtures/stream-instrumentation"
import { TIMEOUT } from "../fixtures/timeouts"

const PROMPT =
  "Create a file called greeting.txt containing 'Hello E2E'. Then reply with ONLY the word 'Done'."

const test = agentTest({ count: 1 })

test.describe("stream diagnostics", () => {
  test("baseline: send → stream → complete (instrumented)", async ({ page, branches, repoName }, testInfo) => {
    const inst = attachStreamInstrumentation(page)

    await test.step("navigate", async () => {
      await navigateToRepo(page, repoName)
      await selectBranch(page, 0)
    })

    await test.step("send", async () => {
      await sendMessage(page, PROMPT)
    })

    await test.step("working + content", async () => {
      await expectAgentWorking(page)
      await expect(page.locator(`text=${PROMPT.slice(0, 30)}`)).toBeVisible({
        timeout: TIMEOUT.UI_READY,
      })
      await expectProseContent(page)
    })

    await test.step("complete", async () => {
      await waitForAgentComplete(page)
    })

    await inst.attachToTest(testInfo)
    // Invariant: at least one successful /api/agent/status after execute
    const statusOk = inst.networkLines.some((l) => l.includes("/api/agent/status") && l.includes("-> 200"))
    expect(statusOk, "expected at least one 200 on /api/agent/status (see attachment)").toBe(true)
  })

  /**
   * Reload while the agent is running to exercise recovery + polling after navigation.
   * Flaky failures here may indicate race between RUNNING, startPolling, and /execution/active.
   */
  test("stress: reload mid-run then expect eventual idle", async ({ page, branches, repoName }, testInfo) => {
    const inst = attachStreamInstrumentation(page)
    const { branchId } = branches[0]

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)
    await sendMessage(page, PROMPT)
    await expectAgentWorking(page)

    // CRITICAL: Wait for execution record to exist before reload
    await waitForExecutionStarted(page, branchId)

    await test.step("reload while agent working", async () => {
      await page.reload({ waitUntil: "load" })
    })

    await navigateToRepo(page, repoName)
    await selectBranch(page, 0)

    // Prefer server completion, then UI: after reload, prose can lag; working can lag after poll completes.
    await test.step("server run completes then UI shows prose", async () => {
      await waitForCompletionViaAPI(page, branchId)
      await expectProseContent(page, TIMEOUT.AGENT_COMPLETE)
      await expect(page.getByText("Agent is working...")).toBeHidden({ timeout: 60_000 })
    })

    await inst.attachToTest(testInfo)
  })
})
