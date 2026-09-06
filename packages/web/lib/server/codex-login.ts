/**
 * Device-code login for the Codex ChatGPT subscription.
 *
 * Runs the official CLI inside a throwaway sandbox rather than reimplementing
 * OpenAI's device flow. The sandbox uses the existing agent snapshot (which
 * already ships @openai/codex) and is created directly rather than through
 * createSandboxForChat, which clones a repo we don't need.
 *
 * After the CLI reports success we refresh once, immediately: the auth.json it
 * writes carries no expiry or refresh-window metadata, and refreshing both
 * fills those in and proves the grant works while the user is still watching.
 *
 * In-flight logins are persisted in the CcAuthInfo table, not an in-memory
 * Map. Production is serverless with per-instance state (see the comment at
 * lib/db/prisma.ts:30) — the POST that starts a login and the GET that polls
 * it can land on different instances, so a module-scope Map would make the
 * poll return "unknown_session" in production while appearing to work in
 * local dev. The row id embeds the userId (`codex-login:<userId>`), so a
 * lookup keyed by the authenticated caller's id is inherently scoped to that
 * user; we additionally compare the client's sessionId against the stored one
 * so a stale client can't poll a login that has since been superseded.
 */
import "server-only"
import { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { getActiveSnapshotName } from "@background-agents/sandbox-image"
import { credentialFromCliAuthFile, credentialFromTokenResponse } from "@/lib/codex-credentials"
import { refreshCodexTokens } from "./codex-oauth"
import { storeCodexCredential } from "./codex-credentials"
import { prisma } from "@/lib/db/prisma"

const AUTH_FILE = "/home/daytona/.codex/auth.json"
const LOGIN_LOG = "/home/daytona/codex-login.log"

/** The device code expires in 15 minutes; never hold a sandbox longer. */
const LOGIN_TTL_MS = 15 * 60 * 1000

/** Strip ANSI colour codes so the CLI's decorated output can be parsed. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "")
}

/**
 * Pull the verification URL and one-time code out of the CLI's output. The URL
 * is static in practice, but parsing it keeps us correct if OpenAI changes it.
 */
export function parseDeviceCodePrompt(stdout: string): { url: string; code: string } | null {
  const clean = stripAnsi(stdout)
  const url = clean.match(/https:\/\/auth\.openai\.com\/\S*device\S*/)?.[0]
  const code = clean.match(/^\s*([A-Z0-9]{4}-[A-Z0-9]{4,6})\s*$/m)?.[1]
  if (!url || !code) return null
  return { url, code }
}

/** Tell the two "device auth unavailable" cases apart so Settings can advise. */
export function classifyDeviceAuthFailure(
  output: string
): "device_auth_disabled" | "admin_blocked" | "unknown" {
  const s = stripAnsi(output).toLowerCase()
  if (s.includes("admin") || s.includes("workspace") || s.includes("policy")) return "admin_blocked"
  if (s.includes("device code") && (s.includes("not enabled") || s.includes("disabled"))) {
    return "device_auth_disabled"
  }
  return "unknown"
}

/** CcAuthInfo row id for a user's in-flight login. Embeds the userId so a
 * lookup scoped to the authenticated caller can never read another user's
 * session. */
function loginRowId(userId: string): string {
  return `codex-login:${userId}`
}

/** What we persist in CcAuthInfo.value (JSON) for an in-flight login. */
interface LoginSessionRow {
  sandboxId: string
  startedAt: number
  sessionId: string
}

function parseLoginSessionRow(value: string): LoginSessionRow | null {
  try {
    const parsed = JSON.parse(value) as Partial<LoginSessionRow>
    if (
      typeof parsed.sandboxId === "string" &&
      typeof parsed.startedAt === "number" &&
      typeof parsed.sessionId === "string"
    ) {
      return { sandboxId: parsed.sandboxId, startedAt: parsed.startedAt, sessionId: parsed.sessionId }
    }
    return null
  } catch {
    return null
  }
}

async function readLoginSession(userId: string): Promise<LoginSessionRow | null> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: loginRowId(userId) },
    select: { value: true },
  })
  return row ? parseLoginSessionRow(row.value) : null
}

async function writeLoginSession(userId: string, session: LoginSessionRow): Promise<void> {
  const id = loginRowId(userId)
  const value = JSON.stringify(session)
  await prisma.ccAuthInfo.upsert({
    where: { id },
    create: { id, value },
    update: { value },
  })
}

async function deleteLoginSession(userId: string): Promise<void> {
  await prisma.ccAuthInfo.delete({ where: { id: loginRowId(userId) } }).catch(() => {})
}

function daytonaClient(): Daytona {
  return new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })
}

/** Best-effort: delete a sandbox by id, swallowing failures. */
async function deleteSandboxById(daytona: Daytona, sandboxId: string): Promise<void> {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()
  } catch (err) {
    console.error("[codex-login] failed to delete sandbox:", sandboxId, err)
  }
}

/** Tear down any login in flight for this user: delete its sandbox, then its row. */
async function teardownExistingLogin(daytona: Daytona, userId: string): Promise<void> {
  const existing = await readLoginSession(userId)
  if (!existing) return
  await deleteSandboxById(daytona, existing.sandboxId)
  await deleteLoginSession(userId)
}

/**
 * Create the login sandbox, start `codex login --device-auth` in the
 * background, and return the code to show the user.
 */
export async function startCodexDeviceLogin(
  userId: string
): Promise<{ sessionId: string; url: string; code: string }> {
  const daytona = daytonaClient()

  // Starting a new login for a user who already has one in flight must clean
  // up the previous sandbox first — otherwise it leaks until its own
  // auto-delete interval fires.
  await teardownExistingLogin(daytona, userId)

  const sandbox = await daytona.create({
    name: `codex-login-${userId.slice(0, 8)}-${Date.now().toString(36)}`,
    snapshot: await getActiveSnapshotName(daytona),
    autoStopInterval: 15,
    autoDeleteInterval: 15,
    public: false,
  })

  try {
    // Background the CLI: it blocks until the user approves in their browser.
    // Pin the credential store to a file — `auto` may prefer an OS keyring,
    // and a Linux sandbox has none.
    await sandbox.process.executeCommand(
      `nohup codex login --device-auth -c cli_auth_credentials_store=file > ${LOGIN_LOG} 2>&1 &`
    )

    // Poll briefly for the prompt; the CLI prints it within a second or two.
    let prompt: { url: string; code: string } | null = null
    for (let i = 0; i < 20 && !prompt; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const res = await sandbox.process.executeCommand(`cat ${LOGIN_LOG} 2>/dev/null || true`)
      prompt = parseDeviceCodePrompt(res.result ?? "")
    }

    if (!prompt) {
      const res = await sandbox.process.executeCommand(`cat ${LOGIN_LOG} 2>/dev/null || true`)
      const reason = classifyDeviceAuthFailure(res.result ?? "")
      throw new Error(`DEVICE_AUTH_UNAVAILABLE:${reason}`)
    }

    const sessionId = randomUUID()
    await writeLoginSession(userId, { sandboxId: sandbox.id, startedAt: Date.now(), sessionId })
    return { sessionId, ...prompt }
  } catch (err) {
    // Every exit path must tear the sandbox down; this is the failure path
    // for the synchronous "did the prompt ever print" branch.
    await sandbox.delete().catch(() => {})
    throw err
  }
}

/**
 * Check whether the user has approved yet. On success: read auth.json, refresh
 * once to establish the expiry window, store, and destroy the sandbox.
 */
export async function pollCodexDeviceLogin(
  userId: string,
  sessionId: string
): Promise<{ status: "pending" | "connected" | "failed"; reason?: string }> {
  const session = await readLoginSession(userId)
  // Compare the client's sessionId against the stored one so a stale client
  // (polling a login that a fresh one has since superseded) can't read
  // another session's result.
  if (!session || session.sessionId !== sessionId) {
    return { status: "failed", reason: "unknown_session" }
  }

  const daytona = daytonaClient()
  const sandbox = await daytona.get(session.sandboxId)

  const cleanup = async () => {
    await deleteLoginSession(userId)
    await sandbox.delete().catch(() => {})
  }

  if (Date.now() - session.startedAt > LOGIN_TTL_MS) {
    await cleanup()
    return { status: "failed", reason: "code_expired" }
  }

  const read = await sandbox.process.executeCommand(`cat ${AUTH_FILE} 2>/dev/null || true`)
  const tokens = credentialFromCliAuthFile((read.result ?? "").trim())
  if (!tokens) return { status: "pending" }

  try {
    // Refresh immediately: this populates expires_at / earliest_refresh_at,
    // which the CLI's file does not carry, and validates the grant now rather
    // than at the user's first run.
    const res = await refreshCodexTokens(tokens.refresh_token)
    await storeCodexCredential(userId, credentialFromTokenResponse(res, tokens.account_id, Date.now()))
    await cleanup()
    return { status: "connected" }
  } catch (err) {
    await cleanup()
    console.error("[codex-login] post-login refresh failed:", (err as Error).message)
    return { status: "failed", reason: "refresh_failed" }
  }
}
