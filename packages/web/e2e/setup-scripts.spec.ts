/**
 * Setup-script end-to-end coverage: a failing script must not block the
 * chat's turn, and an agent's edit to the script must sync back with one
 * revision of undo.
 *
 * Both tests need a REAL Daytona sandbox (the setup script runs as an actual
 * bash job in a real sandbox, not something Eliza or any other fake agent
 * substitutes for) AND a real GitHub-backed repo to clone (environments only
 * attach to a real "owner/repo", never to NEW_REPOSITORY, so there is no
 * git-init-locally shortcut here the way streaming.spec.ts uses). That means
 * this repo's e2e harness needs two things it does not currently have:
 *
 *   1. DAYTONA_API_KEY set when running `npm run test:e2e`.
 *   2. The test-auth user (see app/api/test/auth/route.ts) to have a real
 *      linked GitHub `Account` row with a real access token, so
 *      getGitHubToken(userId) returns something createSandboxForChat can
 *      clone with. Test auth today creates a bare User row with no linked
 *      Account, so any chat pointed at a real repo fails at
 *      "githubToken required for non-NEW_REPOSITORY chats" before a sandbox
 *      is ever created, regardless of DAYTONA_API_KEY.
 *
 * Both tests are gated on DAYTONA_API_KEY as a proxy for "this environment
 * is set up to run real-sandbox e2e specs," matching Step 5 of the plan, but
 * that alone is not sufficient here: without (2) above these will still fail
 * during sandbox bring-up. They are written to the intended end state so
 * they start passing the moment the harness grows a real GitHub token for
 * the test user; until then, expect them to fail at repo clone, not at the
 * setup-script assertions they exist to check.
 */

import { test, expect } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

const REAL_SANDBOX_E2E = !!process.env.DAYTONA_API_KEY

test.describe("setup scripts", () => {
  test.skip(
    !REAL_SANDBOX_E2E,
    "Needs DAYTONA_API_KEY (real sandbox creation) and a GitHub-backed test " +
      "account the test-auth harness does not currently provide; see the " +
      "file header comment."
  )

  test("a failing script does not block the turn and is reported to the user", async ({
    page,
    context,
  }) => {
    test.slow()
    await setupTestAuth(page, context)
    await setDefaultAgentEliza(page)

    const created = await page.request.post("/api/environments", {
      data: { repo: "acme/app", name: "Failing setup" },
    })
    expect(created.ok()).toBeTruthy()
    const { environment } = await created.json()

    const patched = await page.request.patch(`/api/environments/${environment.id}`, {
      data: { setupScript: 'echo "boom"\nexit 3\n' },
    })
    expect(patched.ok()).toBeTruthy()

    await page.route("**/api/github/repos?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          repos: [
            {
              id: 1,
              name: "app",
              full_name: "acme/app",
              owner: { login: "acme" },
              default_branch: "main",
              private: false,
            },
          ],
          page: 1,
          hasMore: false,
        }),
      })
    })

    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("test@playwright.local")).toBeVisible({ timeout: 10000 })

    await page.getByRole("button", { name: "Repository", exact: true }).click()
    await page.getByRole("dialog").getByText("acme/app").click()
    await expect(page.getByRole("button", { name: "Repository", exact: true })).toHaveCount(0)

    const input = page.getByTestId("chat-input")
    await input.click()
    await input.fill("hello")
    await input.press("Enter")

    await expect(page.getByText("Setting up environment")).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("Setup failed, continuing anyway")).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByText("boom")).toBeVisible()

    // Setup failing must not have blocked the turn: the agent still ran.
    await expect(page.getByTestId("assistant-message").last()).toBeVisible({ timeout: 60_000 })
  })

  test("an agent edit to the script is saved and revertable", async ({ page, context }) => {
    test.slow()
    await setupTestAuth(page, context)

    const created = await page.request.post("/api/environments", {
      data: { repo: "acme/app", name: "Agent edited" },
    })
    expect(created.ok()).toBeTruthy()
    const { environment } = await created.json()

    const patched = await page.request.patch(`/api/environments/${environment.id}`, {
      data: { setupScript: "original\n" },
    })
    expect(patched.ok()).toBeTruthy()

    // Drive a real turn asking the agent to rewrite the setup script at its
    // real path, then wait for sync-back to persist the edit.
    await page.route("**/api/github/repos?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          repos: [
            {
              id: 1,
              name: "app",
              full_name: "acme/app",
              owner: { login: "acme" },
              default_branch: "main",
              private: false,
            },
          ],
          page: 1,
          hasMore: false,
        }),
      })
    })

    await page.goto("/")
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 })
    await expect(page.getByText("test@playwright.local")).toBeVisible({ timeout: 10000 })

    await page.getByRole("button", { name: "Repository", exact: true }).click()
    await page.getByRole("dialog").getByText("acme/app").click()
    await expect(page.getByRole("button", { name: "Repository", exact: true })).toHaveCount(0)

    const input = page.getByTestId("chat-input")
    await input.click()
    await input.fill(
      "Rewrite the setup script at /home/daytona/.backgrounder/setup.sh so it just " +
        "contains the single line: rewritten"
    )
    await input.press("Enter")

    await expect(page.getByTestId("chat-container")).toHaveAttribute(
      "data-chat-status",
      /^(ready|error)$/,
      { timeout: 180_000 }
    )

    const after = await (await page.request.get(`/api/environments/${environment.id}`)).json()
    expect(after.environment.setupScriptUpdatedBy).toBe("agent")
    expect(after.environment.setupScript?.trim()).toBe("rewritten")

    const reverted = await page.request.post(`/api/environments/${environment.id}/revert-script`)
    expect(reverted.ok()).toBeTruthy()

    const final = await (await page.request.get(`/api/environments/${environment.id}`)).json()
    expect(final.environment.setupScript).toBe("original\n")
  })
})
