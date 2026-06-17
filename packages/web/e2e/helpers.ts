/**
 * Shared E2E test helpers.
 *
 * Convention: e2e tests should pin the default agent to Eliza so they don't
 * depend on API keys, upstream model availability, or daily-limit windows.
 * Eliza is a local fake agent (regex-based, no LLM) that streams realistic
 * Claude-shaped JSONL. See packages/sdk/src/agents/eliza.
 */

import type { Page, BrowserContext } from "@playwright/test"

/**
 * Authenticate the test user and install the next-auth session cookie on the
 * given browser context. Cookies are context-scoped, so pages opened from
 * this context afterwards are all signed in as the same test user.
 */
export async function setupTestAuth(page: Page, context: BrowserContext): Promise<void> {
  const response = await page.request.post("/api/test/auth")
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to get test auth: ${response.status()} - ${body}`)
  }

  const { token } = await response.json()

  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ])
}

/**
 * Pin the authenticated user's default agent to Eliza for the rest of the
 * test. Must be called after setupTestAuth(). Uses page.request so the call
 * carries the session cookie set on the context.
 */
export async function setDefaultAgentEliza(page: Page): Promise<void> {
  const response = await page.request.patch("/api/user/settings", {
    data: {
      settings: {
        defaultAgent: "eliza",
        defaultModel: "eliza-classic-1.0",
      },
    },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(
      `Failed to pin default agent to Eliza: ${response.status()} - ${body}`
    )
  }
}
