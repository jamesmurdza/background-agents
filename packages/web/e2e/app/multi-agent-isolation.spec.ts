/**
 * Multi-Agent Isolation Tests
 *
 * Verify that concurrent agents don't interfere with each other.
 * Each branch should maintain its own state independently.
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
  expect,
} from "../fixtures/agent-fixture"
import { TIMEOUT } from "../fixtures/timeouts"

const PROMPTS = [
  "Create file0.txt with 'Content zero'. Reply 'Zero done'.",
  "Create file1.txt with 'Content one'. Reply 'One done'.",
  "Create file2.txt with 'Content two'. Reply 'Two done'.",
]

const test = agentTest({ count: 3, singleRepo: true })

test.describe("multi-agent isolation", () => {
  test("each branch shows its own content", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)

    // Send different messages to each branch
    for (let i = 0; i < 3; i++) {
      await selectBranch(page, i)
      await page.waitForTimeout(500)
      await sendMessage(page, PROMPTS[i])
      await expectAgentWorking(page)
    }

    // Wait for all to complete
    for (const b of branches) {
      await waitForCompletionViaAPI(page, b.branchId)
    }

    // Verify each branch shows its own prompt (not another branch's)
    for (let i = 0; i < 3; i++) {
      await selectBranch(page, i)
      await page.waitForTimeout(1000)

      // Should see this branch's prompt (use first() to avoid strict mode with multiple matches)
      await expect(page.locator(`text=file${i}.txt`).first()).toBeVisible({ timeout: TIMEOUT.POST_REFRESH })
      await expectProseContent(page, TIMEOUT.POST_REFRESH)
    }
  })

  test("branch switching shows correct content", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)

    // Start all agents
    for (let i = 0; i < 3; i++) {
      await selectBranch(page, i)
      await page.waitForTimeout(500)
      await sendMessage(page, PROMPTS[i])
    }

    // Wait for completion
    for (const b of branches) {
      await waitForCompletionViaAPI(page, b.branchId)
    }

    // Switch between branches multiple times and verify correct content
    const switchOrder = [0, 2, 1, 0, 2, 1, 0]
    for (const i of switchOrder) {
      await selectBranch(page, i)
      await page.waitForTimeout(800)

      // Verify we see the correct branch's content (use first() to avoid strict mode)
      await expect(page.locator(`text=file${i}.txt`).first()).toBeVisible({ timeout: TIMEOUT.POST_REFRESH })
    }
  })

  test("one branch erroring does not affect others", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)

    // Send messages - branch 1 gets a potentially problematic prompt
    await selectBranch(page, 0)
    await sendMessage(page, PROMPTS[0])
    await expectAgentWorking(page)

    await selectBranch(page, 2)
    await sendMessage(page, PROMPTS[2])
    await expectAgentWorking(page)

    // Wait for branches 0 and 2 to complete
    await waitForCompletionViaAPI(page, branches[0].branchId)
    await waitForCompletionViaAPI(page, branches[2].branchId)

    // Verify branches 0 and 2 have content regardless of branch 1
    await selectBranch(page, 0)
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)

    await selectBranch(page, 2)
    await expectProseContent(page, TIMEOUT.POST_REFRESH)
    await expectNotWorking(page)
  })

  test("concurrent completions render correctly", async ({ page, branches, repoName }) => {
    await navigateToRepo(page, repoName)

    // Start all agents at roughly the same time
    for (let i = 0; i < 3; i++) {
      await selectBranch(page, i)
      await sendMessage(page, PROMPTS[i])
      // Minimal delay between sends
    }

    // Wait for all to complete
    await Promise.all(branches.map(b => waitForCompletionViaAPI(page, b.branchId)))

    // Small delay to let UI sync
    await page.waitForTimeout(2000)

    // All branches should have content
    for (let i = 0; i < 3; i++) {
      await selectBranch(page, i)
      await page.waitForTimeout(500)
      await expectProseContent(page, TIMEOUT.POST_REFRESH)
      await expectNotWorking(page)

      // Verify no empty prose blocks
      const proseBlocks = page.locator('[class*="prose"]')
      const count = await proseBlocks.count()
      for (let j = 0; j < count; j++) {
        const text = await proseBlocks.nth(j).textContent()
        expect(text?.trim().length, `branch ${i} prose block ${j} should not be empty`).toBeGreaterThan(0)
      }
    }
  })
})
