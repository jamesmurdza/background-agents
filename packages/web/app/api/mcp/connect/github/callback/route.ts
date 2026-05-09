/**
 * GET /api/mcp/connect/github/callback
 *
 * Where GitHub redirects after the user installs (or re-configures) our
 * GitHub App. Query params:
 *   - installation_id  the installation we'll use for this user
 *   - setup_action     "install" | "update"
 *   - code, state      OAuth bits we don't use
 *
 * We:
 *   1. Verify the user is signed in (this MUST run in the same browser session
 *      that started the install — popup inherits the parent's cookies).
 *   2. Save installation_id on User.
 *   3. Mint an installation token and upsert the user's Smithery connection
 *      with that token in the Authorization header.
 *   4. Return a tiny HTML page that closes the popup.
 *
 * Anything that goes wrong returns the same closing page with an error
 * message — the parent window polls /api/mcp/connect/github so it'll
 * eventually notice if we never persisted the id.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { getInstallationToken } from "@/lib/github/app"
import { setGithubConnectionAuth } from "@/lib/mcp/smithery-client"

function closingPage(opts: { ok: boolean; message: string }): Response {
  // The parent in McpToolsModal polls /api/mcp/connect/github until the
  // status flips to connected, so the close + reload of state happens there.
  // We just need to release the popup focus.
  const safe = opts.message.replace(/[<>&]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
  )
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

  const url = new URL(req.url)
  const installationId = url.searchParams.get("installation_id")
  const setupAction = url.searchParams.get("setup_action") ?? ""

  if (!installationId) {
    return closingPage({
      ok: false,
      message: "GitHub did not return an installation id. Please try again.",
    })
  }

  try {
    // Save first — even if Smithery setup fails below, we have the id and can
    // recover by re-running the connection setup on next call.
    await prisma.user.update({
      where: { id: userId },
      data: { githubAppInstallationId: installationId },
    })

    // Mint a token and push it into a Smithery connection for this user.
    // `initial: true` so we set mcpUrl on first creation (Smithery rejects
    // mcpUrl changes with 409 on subsequent calls).
    const fresh = await getInstallationToken(installationId)
    const { connectionId } = await setGithubConnectionAuth({
      userId,
      installationToken: fresh.token,
      initial: true,
    })

    await prisma.user.update({
      where: { id: userId },
      data: { smitheryGithubConnectionId: connectionId },
    })

    console.log(
      `[MCP-callback] user=${userId} installationId=${installationId} setupAction=${setupAction} smithery=${connectionId}`
    )
    return closingPage({
      ok: true,
      message: "GitHub connected. You can return to the app.",
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-callback] failed for user ${userId}: ${msg}`)
    return closingPage({
      ok: false,
      message: `GitHub setup failed: ${msg}`,
    })
  }
}
