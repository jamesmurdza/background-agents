/**
 * Netlify connection used to deploy a repo.
 *
 * The OAuth token is stored encrypted in User.credentials like the other
 * server-managed credentials. It is only used here on the server: it's never
 * returned to the client and never injected into a sandbox.
 */
import "server-only"
import type { CredentialId } from "@background-agents/common"
import { prisma } from "@/lib/db/prisma"
import { encrypt, decrypt } from "@/lib/db/encryption"
import { normalizeStoredCredentials } from "@/lib/credentials"
import { escapeHtml } from "@/lib/html"
import { appBaseUrl } from "./app-url"
import { withUserLock } from "./codex-credentials"

const CREDENTIAL_KEY: CredentialId = "NETLIFY_OAUTH_TOKEN"

/** Cookie holding the OAuth `state` between /connect and /callback. */
export const NETLIFY_STATE_COOKIE = "netlify_oauth_state"

/** Must match the redirect URI registered on the Netlify OAuth application. */
export function netlifyRedirectUri(): string {
  return `${appBaseUrl()}/api/netlify/callback`
}

/**
 * The user's stored Netlify token. Read directly rather than through
 * getUserCredentials, which falls back to process.env for unset credentials.
 */
export async function readNetlifyToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { credentials: true } })
  const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)[CREDENTIAL_KEY]
  return stored ? decrypt(stored) : null
}

type EnvByRepo = Record<string, Record<string, string>>

/** The repo's deployment env vars (Environment Variables → Deployment), decrypted. */
export async function readDeployEnv(userId: string, repo: string): Promise<Record<string, string>> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deployEnvironmentVariables: true } })
  const encrypted = (user?.deployEnvironmentVariables as EnvByRepo | null)?.[repo] ?? {}
  return Object.fromEntries(Object.entries(encrypted).map(([key, value]) => [key, decrypt(value)]))
}

/** Store the repo's deployment env vars encrypted, like the repository ones. */
export async function writeDeployEnv(userId: string, repo: string, env: Record<string, string>): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { deployEnvironmentVariables: true } })
  const all = (user?.deployEnvironmentVariables as EnvByRepo | null) ?? {}
  if (Object.keys(env).length > 0) {
    all[repo] = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, encrypt(value)]))
  } else {
    delete all[repo]
  }
  await prisma.user.update({ where: { id: userId }, data: { deployEnvironmentVariables: all } })
}

/** Store the user's Netlify token, or remove it when `token` is null. */
export async function writeNetlifyToken(userId: string, token: string | null): Promise<void> {
  await withUserLock(userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { credentials: true } })
    const stored = normalizeStoredCredentials(user?.credentials as Record<string, unknown> | null)
    if (token) {
      stored[CREDENTIAL_KEY] = encrypt(token)
    } else {
      delete stored[CREDENTIAL_KEY]
    }
    await tx.user.update({ where: { id: userId }, data: { credentials: stored as never } })
  })
}

/**
 * Page shown in the connect popup. On success it closes itself, and Settings
 * refreshes once the popup is gone; on failure it stays open so the message
 * can be read.
 */
export function netlifyPopupPage(ok: boolean, message: string): Response {
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>Netlify ${ok ? "connected" : "connection failed"}</title></head>
<body style="font: 14px system-ui, sans-serif; padding: 24px; color: ${ok ? "#1a7f37" : "#cf222e"}">
  <p>${escapeHtml(message)}</p>
  ${ok ? `<script>setTimeout(function () { try { window.close(); } catch (e) {} }, 800)</script>` : "<p>You can close this window.</p>"}
</body></html>`
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
