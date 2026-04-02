/**
 * Shared Playwright fixture for agent E2E tests.
 *
 * Provides:
 *   - Setup/teardown (test user, auth, Daytona sandboxes, DB scaffold)
 *   - Helper methods for common UI interactions
 *   - Typed BranchInfo
 */
import { test as base, expect, type Page } from "@playwright/test"
import { TIMEOUT } from "./timeouts"

export interface BranchInfo {
  branchId: string
  sandboxId: string
  repoName: string
}

interface AgentFixture {
  branches: BranchInfo[]
  repoName: string
}

/**
 * Create a test fixture that sets up N branches (optionally under one repo)
 * and tears them down after the test.
 */
export function agentTest(opts: { count: number; singleRepo?: boolean }) {
  return base.extend<AgentFixture>({
    branches: async ({ page }, use) => {
      const res = await page.request.post("/api/e2e/setup", {
        data: { count: opts.count, singleRepo: opts.singleRepo ?? false },
      })
      expect(res.ok()).toBe(true)
      const data = await res.json()
      const branches: BranchInfo[] = data.branches
      expect(branches).toHaveLength(opts.count)

      await use(branches)

      // Teardown
      try {
        await page.request.delete("/api/e2e/setup", {
          data: { sandboxIds: branches.map((b) => b.sandboxId) },
        })
      } catch {
        /* best effort */
      }
    },

    repoName: async ({ branches }, use) => {
      await use(branches[0].repoName)
    },
  })
}

// ── Helpers ──

/** Navigate to a repo page and wait for it to load. */
export async function navigateToRepo(page: Page, repoName: string) {
  await page.goto(`/repo/e2e-test/${repoName}`)
  await expect(page.locator("main")).not.toContainText("Redirecting to login", {
    timeout: TIMEOUT.PAGE_LOAD,
  })
}

/** Wait for a branch button to appear in the sidebar and click it. */
export async function selectBranch(page: Page, index: number) {
  const btn = page.getByRole("button", { name: new RegExp(`e2e-branch-${index}`) })
  await expect(btn).toBeVisible({ timeout: TIMEOUT.SIDEBAR_READY })
  await btn.click()
  await expect(page.locator("textarea")).toBeVisible({ timeout: TIMEOUT.UI_READY })
}

/** Type a prompt into the textarea and press Enter. */
export async function sendMessage(page: Page, prompt: string) {
  const textarea = page.locator("textarea")
  await textarea.fill(prompt)
  await textarea.press("Enter")
}

/** Assert that the "Agent is working..." indicator is visible. */
export async function expectAgentWorking(page: Page) {
  await expect(page.getByText("Agent is working...")).toBeVisible({
    timeout: TIMEOUT.AGENT_START,
  })
}

/** Wait for the agent to finish (working indicator hidden). */
export async function waitForAgentComplete(page: Page) {
  await expect(page.getByText("Agent is working...")).toBeHidden({
    timeout: TIMEOUT.AGENT_COMPLETE,
  })
}

/** Wait for streaming prose content to appear. */
export async function expectProseContent(page: Page, timeout = TIMEOUT.CONTENT_STREAM) {
  await expect(async () => {
    const count = await page.locator('[class*="prose"]').count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout })
}

/** Wait for tool call items to appear in the UI. */
export async function expectToolCalls(page: Page) {
  await expect(async () => {
    const count = await page.locator("text=/Write|Bash|Read|Edit|Glob|Grep/i").count()
    expect(count).toBeGreaterThan(0)
  }).toPass({ timeout: TIMEOUT.TOOL_CALLS })
}

/** Assert no "Agent is working..." indicator is shown. */
export async function expectNotWorking(page: Page) {
  const stuck = await page.getByText("Agent is working...").isVisible().catch(() => false)
  expect(stuck).toBe(false)
}

/** Poll the API until a branch's execution is completed or errored. */
export async function waitForCompletionViaAPI(page: Page, branchId: string) {
  let undefinedCount = 0
  const maxUndefined = 5 // Fail fast if execution is missing after 5 polls

  await expect(async () => {
    const res = await page.request.post("/api/agent/execution/active", {
      data: { branchId },
    })
    const data = await res.json()
    const status = data.execution?.status

    // Fail fast if execution is consistently undefined
    if (status === undefined) {
      undefinedCount++
      if (undefinedCount >= maxUndefined) {
        throw new Error(`No execution found for branch ${branchId} after ${maxUndefined} polls`)
      }
    } else {
      undefinedCount = 0 // Reset if we get a valid status
    }

    expect(status).toMatch(/completed|error/)
  }).toPass({ timeout: TIMEOUT.AGENT_COMPLETE, intervals: [1000, 2000, 3000] })
}

export { expect }
