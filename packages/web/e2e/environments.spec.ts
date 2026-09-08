/**
 * Composer environment picker (Task 8 of the cloud-environments plan).
 *
 * This deliberately does not re-test the /environments editor page (create,
 * duplicate, promote-to-default, delete): that page is Task 7's, already has
 * route-level coverage in app/api/environments/**\/*.test.ts, and this task
 * adds nothing to it. It also does not exercise "restricted" network mode:
 * NetworkModeFields.tsx disables that radio outright (the installed
 * @daytonaio/sdk has no domain-allowlist field yet; see the comment at the
 * top of that file), so there is nothing to round-trip.
 *
 * What this task actually adds is the environment picker in the chat
 * composer, and the one thing worth an end-to-end check is that picking a
 * non-default environment there is what the created chat actually gets.
 */

import { test, expect } from "@playwright/test"
import { setupTestAuth, setDefaultAgentEliza } from "./helpers"

test("picking a non-default environment in the composer pins the created chat to it", async ({
  page,
  context,
}) => {
  await setupTestAuth(page, context)
  await setDefaultAgentEliza(page)

  // Seed two environments for a repo so the picker has something to choose
  // between (a repo with a single environment hides the picker: nothing to
  // pick). The first one created becomes the repo's default.
  const defaultRes = await page.request.post("/api/environments", {
    data: { repo: "acme/app", name: "Default" },
  })
  expect(defaultRes.ok()).toBeTruthy()
  const { environment: defaultEnv } = await defaultRes.json()
  expect(defaultEnv.isDefault).toBe(true)

  const stagingRes = await page.request.post("/api/environments", {
    data: { repo: "acme/app", name: "Staging" },
  })
  expect(stagingRes.ok()).toBeTruthy()
  const { environment: stagingEnv } = await stagingRes.json()
  expect(stagingEnv.isDefault).toBe(false)

  // The composer's repo picker calls the real GitHub API, so stub it with a
  // single fake repo so the test doesn't depend on a real GitHub account or
  // token (same technique as e2e/repo-picker.spec.ts).
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
  // Wait for the session to hydrate before touching anything chat-state
  // related (same wait streaming.spec.ts uses).
  await expect(page.getByText("test@playwright.local")).toBeVisible({ timeout: 10000 })

  await page.getByRole("button", { name: "Repository", exact: true }).click()
  await page.getByRole("dialog").getByText("acme/app").click()

  // Confirm the repo actually landed before touching the environment
  // picker: it only renders once chat.repo is a real repo.
  await expect(page.getByRole("button", { name: "Repository", exact: true })).toHaveCount(0)

  // exact: true matters, since the sidebar nav has an "Environments" button and a
  // substring match on "Environment" would hit that instead.
  const environmentButton = page.getByRole("button", { name: "Environment", exact: true })
  await expect(environmentButton).toBeVisible()
  await environmentButton.click()
  await page.getByRole("option", { name: /Staging/ }).click()

  const input = page.getByTestId("chat-input")
  await input.click()
  await input.fill("Hello from the environment picker test")

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith("/api/chats") && res.request().method() === "POST"
    ),
    input.press("Enter"),
  ])
  expect(response.ok()).toBeTruthy()
  const createdChat = await response.json()

  // This is the round trip the task exists to verify: the id picked in the
  // composer is what actually landed on the chat row, not silently the repo's
  // default.
  expect(createdChat.environmentId).toBe(stagingEnv.id)
  expect(createdChat.environmentId).not.toBe(defaultEnv.id)
})
