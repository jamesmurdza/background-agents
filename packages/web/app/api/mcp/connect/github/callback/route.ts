/**
 * GET /api/mcp/connect/github/callback
 *
 * Where GitHub redirects after the user installs (or re-configures) our App.
 * We persist `installation_id` on the User and return a tiny HTML page that
 * closes the popup. The parent window polls /api/mcp/connect/github so it
 * notices the connected state on its own.
 *
 * Query params from GitHub:
 *   - installation_id  the installation we'll use for this user
 *   - setup_action     "install" | "update"
 *   - code, state      OAuth bits we don't use
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { escapeHtml } from "@/lib/html"

function closingPage(opts: { ok: boolean; message: string }): Response {
  const safe = escapeHtml(opts.message)
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>GitHub setup ${opts.ok ? "complete" : "failed"}</title>
<style>
  body { font: 14px system-ui, sans-serif; padding: 24px; color: #333; }
  .ok { color: #1a7f37; }
  .err { color: #cf222e; }
</style>
</head>
<body>
  <p class="${opts.ok ? "ok" : "err"}">${safe}</p>
  <p>You can close this window.</p>
  <script>
    try { window.opener && window.opener.postMessage({ source: "github-app-install", ok: ${opts.ok} }, "*"); } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
  </script>
</body></html>`
  return new Response(body, {
    status: opts.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) {
    return closingPage({
      ok: false,
      message: "You must be signed in to finish GitHub setup.",
    })
  }
  const { userId } = auth

  const installationId = new URL(req.url).searchParams.get("installation_id")
  if (!installationId) {
    return closingPage({
      ok: false,
      message: "GitHub did not return an installation id. Please try again.",
    })
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { githubAppInstallationId: installationId },
    })
    return closingPage({
      ok: true,
      message: "GitHub connected. You can return to the app.",
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-callback] failed for user ${userId}: ${msg}`)
    return closingPage({ ok: false, message: `GitHub setup failed: ${msg}` })
  }
}
