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
import {
  credentialFromCliAuthFile,
  credentialFromTokenResponse,
  type CodexStoredCredential,
} from "@/lib/codex-credentials"
import { refreshCodexTokens } from "./codex-oauth"
import { storeCodexCredential } from "./codex-credentials"
import { prisma } from "@/lib/db/prisma"

const AUTH_FILE = "/home/daytona/.codex/auth.json"
const LOGIN_LOG = "/home/daytona/codex-login.log"

/** The device code expires in 15 minutes; never hold a sandbox longer. */
const LOGIN_TTL_MS = 15 * 60 * 1000

/** How often to check the CLI's log for the device-code prompt. */
const PROMPT_POLL_INTERVAL_MS = 500

/**
 * 30s total. A cold sandbox boot (image pull, CLI startup) can genuinely take
 * several seconds before the CLI prints anything at all — this window has to
 * be generous enough that a slow start is never mistaken for the CLI having
 * started and then hit a real error. `hasCliStarted` is what lets the loop
 * tell those two cases apart before the window even matters.
 */
const PROMPT_POLL_MAX_ITERATIONS = 60

/** How many times to retry persisting a freshly-rotated credential before
 * giving up. See storeCredentialWithRetry for why this matters more than a
 * typical "best effort" retry. */
const STORE_CREDENTIAL_RETRY_ATTEMPTS = 3
const STORE_CREDENTIAL_RETRY_DELAY_MS = 250

/**
 * Strip ANSI colour codes so the CLI's decorated output can be parsed.
 *
 * The leading ESC (0x1b) is part of the sequence and MUST be matched: without
 * it the brackets go but the ESC bytes stay, and since `\x1b` is not `\s` in
 * JavaScript the anchored one-time-code regex in parseDeviceCodePrompt never
 * matches a coloured line — turning a perfectly good login into
 * DEVICE_AUTH_UNAVAILABLE:unknown on the feature's very first interaction.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "")
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

/**
 * Whether the CLI has printed anything at all yet, as distinct from whether
 * it has reached the device-code prompt. The poll loop in
 * startCodexDeviceLogin uses this to tell "still cold-starting" apart from
 * "started, but failed": without it, a slow sandbox boot and a genuine
 * account-level block both fall through to classifyDeviceAuthFailure after
 * the same timeout, and a slow boot gets misreported to the user as "your
 * account can't use device auth" — the first thing a user does with this
 * feature, so a false negative here is expensive.
 */
export function hasCliStarted(output: string): boolean {
  return stripAnsi(output).trim().length > 0
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
  return (await readLoginSessionRaw(userId))?.session ?? null
}

/**
 * Read the session AND the exact stored JSON it was parsed from.
 *
 * The raw string is what makes the claim in pollCodexDeviceLogin atomic: the
 * delete matches on `value` as well as `id`, so it can only ever remove the
 * very row this caller read. A login that was superseded in between (a second
 * `startCodexDeviceLogin` overwrote the row) has a different value and is
 * therefore left alone rather than eaten by a stale poll.
 */
async function readLoginSessionRaw(
  userId: string
): Promise<{ session: LoginSessionRow; raw: string } | null> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: loginRowId(userId) },
    select: { value: true },
  })
  if (!row) return null
  const session = parseLoginSessionRow(row.value)
  return session ? { session, raw: row.value } : null
}

/**
 * Atomically claim the right to spend this login's refresh token.
 *
 * The token the CLI wrote into the sandbox is single-use: `refreshCodexTokens`
 * rotates it, and a second refresh of the same token comes back
 * invalid_grant / refresh_token_reused, which this module treats as terminal.
 * The poll runs on a 2s client interval with an 8s fetch budget behind it, so
 * overlapping polls (a slow round trip, or two browser tabs sharing a
 * sessionId) are ordinary, not exotic — without a claim they both read the
 * same auth.json and both refresh, and the loser destroys a login the user
 * just completed.
 *
 * Deleting the row IS the claim: exactly one caller can observe count === 1.
 * Everyone else backs off reporting "pending" and — crucially — does not touch
 * the winner's sandbox.
 */
async function claimLoginSession(userId: string, raw: string): Promise<boolean> {
  const { count } = await prisma.ccAuthInfo.deleteMany({
    where: { id: loginRowId(userId), value: raw },
  })
  return count === 1
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

    // Poll for the prompt; the CLI usually prints it within a second or two,
    // but a cold sandbox boot can take longer, so we wait up to 30s total.
    let prompt: { url: string; code: string } | null = null
    let lastOutput = ""
    for (let i = 0; i < PROMPT_POLL_MAX_ITERATIONS && !prompt; i++) {
      await new Promise((r) => setTimeout(r, PROMPT_POLL_INTERVAL_MS))
      const res = await sandbox.process.executeCommand(`cat ${LOGIN_LOG} 2>/dev/null || true`)
      lastOutput = res.result ?? ""
      prompt = parseDeviceCodePrompt(lastOutput)
      if (prompt) break

      if (!hasCliStarted(lastOutput)) {
        // Nothing printed yet at all — this is a cold start, not a failure.
        // Keep waiting rather than classifying an error that hasn't happened.
        continue
      }

      // The CLI has started but hasn't reached the prompt yet. If it has
      // already printed a real, recognizable failure, stop now instead of
      // burning the rest of the 30s window.
      if (classifyDeviceAuthFailure(lastOutput) !== "unknown") break
    }

    if (!prompt) {
      const reason = classifyDeviceAuthFailure(lastOutput)
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
 * Persist a freshly-rotated credential, retrying a few times before giving up.
 *
 * This is not a routine "best effort" retry: by the time this is called,
 * refreshCodexTokens has already rotated the refresh token with OpenAI,
 * invalidating the OLD one — and pollCodexDeviceLogin's cleanup() is about to
 * delete the sandbox that holds the only copy of that old token. If a
 * transient DB or lock failure makes storeCodexCredential throw right here, a
 * naive single attempt would delete the sandbox anyway, permanently losing
 * both the old token (invalidated) and the new one (never persisted) — the
 * user completed a real browser approval and their only path forward is
 * redoing the entire device-code flow. A few retries with backoff make that
 * failure mode rare rather than "one hiccup away".
 */
async function storeCredentialWithRetry(
  userId: string,
  cred: CodexStoredCredential
): Promise<boolean> {
  for (let attempt = 1; attempt <= STORE_CREDENTIAL_RETRY_ATTEMPTS; attempt++) {
    try {
      await storeCodexCredential(userId, cred)
      return true
    } catch (err) {
      if (attempt === STORE_CREDENTIAL_RETRY_ATTEMPTS) {
        // Loud and specific on purpose: this is the one failure in this
        // module that is NOT recoverable by a later cron sweep or retry — the
        // sandbox holding the rotated grant is about to be deleted by the
        // caller, so once this line fires the user's only path forward is a
        // fresh device-code login.
        console.error(
          `[codex-login] CRITICAL: rotated Codex credential for user ${userId} could not be ` +
            `persisted after ${STORE_CREDENTIAL_RETRY_ATTEMPTS} attempts. OpenAI has already ` +
            "invalidated the previous refresh token and the login sandbox is being torn down " +
            "— this grant is now unrecoverable without redoing device-code login.",
          err
        )
        return false
      }
      await new Promise((r) => setTimeout(r, STORE_CREDENTIAL_RETRY_DELAY_MS * attempt))
    }
  }
  return false
}

/**
 * Check whether the user has approved yet. On success: read auth.json, refresh
 * once to establish the expiry window, store, and destroy the sandbox.
 */
export async function pollCodexDeviceLogin(
  userId: string,
  sessionId: string
): Promise<{ status: "pending" | "connected" | "failed"; reason?: string }> {
  const loginSession = await readLoginSessionRaw(userId)
  // Compare the client's sessionId against the stored one so a stale client
  // (polling a login that a fresh one has since superseded) can't read
  // another session's result.
  if (!loginSession || loginSession.session.sessionId !== sessionId) {
    return { status: "failed", reason: "unknown_session" }
  }
  const session = loginSession.session

  const daytona = daytonaClient()

  if (Date.now() - session.startedAt > LOGIN_TTL_MS) {
    await deleteLoginSession(userId)
    await deleteSandboxById(daytona, session.sandboxId)
    return { status: "failed", reason: "code_expired" }
  }

  // Every exit path must tear the sandbox down, including one we can't even
  // get a handle to (or read from) — wrap both calls so a Daytona hiccup here
  // fails closed instead of throwing past cleanup and leaving the login
  // stuck until the next TTL sweep.
  let sandbox: Awaited<ReturnType<Daytona["get"]>>
  let read: { result?: string }
  try {
    sandbox = await daytona.get(session.sandboxId)
    read = await sandbox.process.executeCommand(`cat ${AUTH_FILE} 2>/dev/null || true`)
  } catch (err) {
    console.error("[codex-login] failed to reach sandbox during poll:", session.sandboxId, err)
    await deleteLoginSession(userId)
    await deleteSandboxById(daytona, session.sandboxId)
    return { status: "failed", reason: "sandbox_unavailable" }
  }

  const tokens = credentialFromCliAuthFile((read.result ?? "").trim())
  if (!tokens) return { status: "pending" }

  // Claim before spending. A caller that loses the claim has NOT rotated
  // anything and must not tear down the winner's sandbox, so it simply reports
  // pending; the winner's own result reaches the client on its next poll.
  if (!(await claimLoginSession(userId, loginSession.raw))) {
    return { status: "pending" }
  }

  // The claim already removed the session row, so teardown from here on is
  // just the sandbox.
  const cleanup = async () => {
    await sandbox.delete().catch(() => {})
  }

  try {
    // Refresh immediately: this populates expires_at / earliest_refresh_at,
    // which the CLI's file does not carry, and validates the grant now rather
    // than at the user's first run.
    const res = await refreshCodexTokens(tokens.refresh_token)
    const cred = credentialFromTokenResponse(res, tokens.account_id, Date.now())
    const persisted = await storeCredentialWithRetry(userId, cred)
    await cleanup()
    if (!persisted) return { status: "failed", reason: "credential_lost" }
    return { status: "connected" }
  } catch (err) {
    await cleanup()
    console.error("[codex-login] post-login refresh failed:", (err as Error).message)
    return { status: "failed", reason: "refresh_failed" }
  }
}
