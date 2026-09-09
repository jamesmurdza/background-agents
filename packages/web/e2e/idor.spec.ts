/**
 * IDOR regression test for the /api/agent/stream route.
 *
 * Before the fix, the route used `url.searchParams.get("sandboxId")` and
 * `daytona.get(sandboxId)`. Since Daytona is keyed by one app-wide API key
 * (all sandboxes share one org), a user could supply any other user's
 * sandbox id and the route would happily start streaming from it. The
 * smoking gun was the Daytona SDK error mentioning the URL-supplied id
 * verbatim — meaning the route used that value to look up the sandbox.
 *
 * After the fix, the route derives sandboxId from the auth-checked chat
 * row. A chat with sandboxId=null should NEVER produce a daytona.get()
 * call for a foreign id, even if one is supplied on the URL.
 *
 * This test creates a chat with sandboxId=null, hits the route with a
 * blatantly fake sandboxId, and asserts the route does NOT echo that
 * fake id in its error path — proving it ignored the query param.
 *
 * This file also covers the /api/environments IDOR surface: every [id] route
 * must scope its lookup to userId so another user's environment id returns
 * 404 rather than leaking existence, is readable, is editable, or is
 * deletable.
 */

import { test, expect } from "@playwright/test"
import { setupTestAuth } from "./helpers"

test("IDOR fix: route ignores url-supplied sandboxId and uses chat row", async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await setupTestAuth(page, context)

  // Chat with sandboxId=null and backgroundSessionId=null in the DB.
  const createResp = await page.request.post("/api/chats", {
    data: {
      repo: "__new__",
      baseBranch: "main",
      agent: "eliza",
      model: "eliza-classic-1.0",
      status: "pending",
    },
  })
  expect(createResp.ok()).toBeTruthy()
  const { id: chatId } = await createResp.json()

  // Hit the SSE endpoint with a blatantly fake sandboxId. Pre-fix, the
  // server would log "[agent/stream] Error: Sandbox with ID or name
  // FAKE-FOREIGN-... not found" and we could grep the response body for
  // that string. Post-fix, the server bails with a generic "Chat has no
  // active sandbox or background session" 400 — and crucially does NOT
  // reference the URL-supplied fake id.
  const FAKE = "FAKE-FOREIGN-SANDBOX-FROM-IDOR-TEST"
  const params = new URLSearchParams({
    chatId,
    sandboxId: FAKE,
    backgroundSessionId: "FAKE-FOREIGN-BG",
    repoName: "project",
  })
  const sseResp = await page.request.fetch(`/api/agent/stream?${params}`, {
    headers: { Accept: "text/event-stream" },
    timeout: 15000,
  })

  const body = await sseResp.text()

  // The fake id MUST NOT appear anywhere in the response — neither in an
  // SSE error frame nor a Daytona error message — because the route should
  // have ignored the query param entirely.
  expect(
    body,
    "post-IDOR-fix, response must not echo the url-supplied sandboxId"
  ).not.toContain(FAKE)

  // And the response should indicate the chat itself has no sandbox, not
  // some downstream Daytona failure.
  expect(sseResp.status()).toBe(400)
  expect(body).toContain("no active sandbox")

  await context.close()
})

test("another user's environment is not readable, editable, or deletable", async ({ request }) => {
  // Pure HTTP test (no page render), same convention as chat-mass-assignment.spec.ts:
  // authenticate by fetching a test session token and sending it as the
  // next-auth cookie on each request. `?user=b` on the second call picks a
  // distinct, stable test user so this is a real cross-user check rather than
  // the same user asserting against itself.
  const authA = await request.post("/api/test/auth")
  expect(authA.ok()).toBeTruthy()
  const { token: tokenA } = await authA.json()
  const headersA = { Cookie: `next-auth.session-token=${tokenA}` }

  const authB = await request.post("/api/test/auth?user=b")
  expect(authB.ok()).toBeTruthy()
  const { token: tokenB } = await authB.json()
  const headersB = { Cookie: `next-auth.session-token=${tokenB}` }

  // Create an environment as user A, then attempt every verb as user B.
  const created = await request.post("/api/environments", {
    headers: headersA,
    data: { repo: "acme/app", name: "Victim" },
  })
  expect(created.status()).toBe(201)
  const { environment } = await created.json()

  const get = await request.get(`/api/environments/${environment.id}`, { headers: headersB })
  expect(get.status()).toBe(404)

  const patch = await request.patch(`/api/environments/${environment.id}`, {
    headers: headersB,
    data: { name: "Hijacked" },
  })
  expect(patch.status()).toBe(404)

  const usage = await request.get(`/api/environments/${environment.id}/usage`, {
    headers: headersB,
  })
  expect(usage.status()).toBe(404)

  const del = await request.delete(`/api/environments/${environment.id}`, { headers: headersB })
  expect(del.status()).toBe(404)

  // And user A can still reach their own environment: the 404s above are
  // ownership-scoping, not the row having vanished.
  const getA = await request.get(`/api/environments/${environment.id}`, { headers: headersA })
  expect(getA.status()).toBe(200)
})
