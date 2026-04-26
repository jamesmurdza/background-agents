import { Daytona, Image, type Sandbox } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"

export const CLAUDE_CREDS_KEY = "claude-credentials"
export const CLAUDE_COOKIES_KEY = "claude-cookies"

const VOLUME_NAME = "ccauth-profile"
const VOLUME_READY_TIMEOUT_MS = 60_000
const VOLUME_POLL_INTERVAL_MS = 1500
const COOKIES_REMOTE_PATH = "/tmp/cookies.json"
// ccauth stores its persistent patchright profile at $HOME/.ccauth/patchright-profile
// (see ccauth/modes/cookie_based.py:17). Daytona's default sandbox HOME is
// /home/daytona, so we mount the volume there to accumulate Turnstile trust
// signals across runs.
const PATCHRIGHT_PROFILE_PATH = "/home/daytona/.ccauth/patchright-profile"

const CCAUTH_REPO = "synacktraa/ccauth"
const CCAUTH_BRANCH = "master"

/**
 * Resolves the latest commit SHA on `master` so the pip install command becomes
 * `git+...@<sha>`. When the SHA changes, the Image spec hash changes, and
 * Daytona rebuilds the snapshot — picking up any ccauth fix automatically
 * without manual SHA bumps.
 */
async function resolveLatestCCAuthSha(): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${CCAUTH_REPO}/commits/${CCAUTH_BRANCH}`,
    { headers: { Accept: "application/vnd.github+json" } },
  )
  if (!res.ok) {
    throw new Error(
      `Failed to resolve latest ccauth SHA (GitHub API ${res.status}): ${await res
        .text()
        .catch(() => "<no body>")}`,
    )
  }
  const data = (await res.json()) as { sha?: string }
  if (!data.sha) {
    throw new Error("GitHub API returned no sha field")
  }
  return data.sha
}

function getCCAuthImage(sha: string) {
  return Image.debianSlim("3.12")
    .runCommands(
      "apt-get update && apt-get install -y --no-install-recommends " +
        "git xvfb xauth x11vnc novnc xfce4 xfce4-terminal dbus-x11 " +
        "&& rm -rf /var/lib/apt/lists/*",
    )
    .pipInstall([`git+https://github.com/${CCAUTH_REPO}.git@${sha}`])
    .runCommands("patchright install --with-deps chrome")
    .workdir("/home/daytona")
}

export interface ClaudeOAuthCredentials {
  claudeAiOauth: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: string[]
    subscriptionType?: string
    rateLimitTier?: string
  }
}

function isClaudeOAuthCredentials(value: unknown): value is ClaudeOAuthCredentials {
  if (!value || typeof value !== "object") return false
  const oauth = (value as { claudeAiOauth?: unknown }).claudeAiOauth
  if (!oauth || typeof oauth !== "object") return false
  const o = oauth as Record<string, unknown>
  return (
    typeof o.accessToken === "string" &&
    typeof o.refreshToken === "string" &&
    typeof o.expiresAt === "number"
  )
}

/**
 * Reads the shared Claude Code credentials row from Postgres.
 *
 * Returns the raw JSON string in the shape `{"claudeAiOauth": {...}}` —
 * exactly what `CLAUDE_CODE_CREDENTIALS` expects (and what the user would
 * otherwise paste into Settings as `anthropicAuthToken`).
 *
 * No cache. The token's expiry is the only freshness contract; the cron
 * keeps the row refreshed at least 2 hours ahead of expiry.
 */
export async function getClaudeCredentials(): Promise<string> {
  const row = await prisma.ccAuthInfo.findUnique({
    where: { id: CLAUDE_CREDS_KEY },
    select: { value: true },
  })
  if (!row) {
    throw new Error(
      `CcAuthInfo row '${CLAUDE_CREDS_KEY}' not found in database`,
    )
  }
  return row.value
}

/**
 * Provisions an ephemeral Daytona sandbox, runs `ccauth --cookies <path>` against
 * the supplied claude.ai cookies, and returns the parsed credential JSON.
 *
 * The persistent patchright profile lives on a Daytona volume named `ccauth-profile`
 * mounted at /home/daytona/.ccauth/patchright-profile so Cloudflare Turnstile trust
 * signals accumulate across cron runs.
 */
export async function generateClaudeCredentials(
  cookies: string,
): Promise<ClaudeOAuthCredentials> {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set")

  const ccauthSha = await resolveLatestCCAuthSha()
  console.error(`[claude-credentials] using ccauth ${ccauthSha.slice(0, 12)}`)
  const ccauthImage = getCCAuthImage(ccauthSha)

  const daytona = new Daytona({ apiKey })

  // volume.get(..., true) creates on first run, but the volume comes back in
  // `pending_create` state; mounting it before it's `ready` 400s. Poll until
  // ready before sandbox creation.
  let volume = await daytona.volume.get(VOLUME_NAME, true)
  const volumeDeadline = Date.now() + VOLUME_READY_TIMEOUT_MS
  while (volume.state !== "ready" && Date.now() < volumeDeadline) {
    await new Promise((r) => setTimeout(r, VOLUME_POLL_INTERVAL_MS))
    volume = await daytona.volume.get(VOLUME_NAME, false)
  }
  if (volume.state !== "ready") {
    throw new Error(
      `Volume '${VOLUME_NAME}' not ready after ${VOLUME_READY_TIMEOUT_MS}ms (state: ${volume.state})`,
    )
  }

  let sandbox: Sandbox | undefined
  try {
    sandbox = await daytona.create(
      {
        image: ccauthImage,
        ephemeral: true,
        volumes: [{ volumeId: volume.id, mountPath: PATCHRIGHT_PROFILE_PATH }],
        autoStopInterval: 5,
      },
      {
        timeout: 0,
        onSnapshotCreateLogs: (chunk) =>
          console.error(`[ccauth-image] ${chunk}`),
      },
    )

    await sandbox.fs.uploadFile(Buffer.from(cookies, "utf8"), COOKIES_REMOTE_PATH)

    // ccauth runs Chrome headed (Turnstile flags headless). xvfb-run spins up a
    // throwaway X display, sets DISPLAY for ccauth, and tears it down on exit.
    // ccauth always emits JSON on stdout: {"claudeAiOauth": {...}} on success
    // (exit 0) or {"error": ..., extra} on failure (exit 1). Verbose logs go
    // to stderr.
    const res = await sandbox.process.executeCommand(
      `xvfb-run -a ccauth --cookies ${COOKIES_REMOTE_PATH}`,
      undefined,
      undefined,
      300,
    )

    const output = res.result ?? ""

    if (res.exitCode !== 0) {
      throw new Error(
        `ccauth failed (exit ${res.exitCode}): ${output.slice(0, 4000) || "(no output)"}`,
      )
    }

    // Daytona's executeCommand merges stdout and stderr into `result`. ccauth
    // emits its single-line JSON last (after stderr-bound progress logs), so
    // pick the final non-empty line and parse that.
    const lastLine = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .pop()
    if (!lastLine) {
      throw new Error(`ccauth produced empty output`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(lastLine)
    } catch {
      throw new Error(
        `ccauth produced non-JSON final line: ${lastLine.slice(0, 4000)}`,
      )
    }

    if (!isClaudeOAuthCredentials(parsed)) {
      throw new Error(
        `ccauth output missing claudeAiOauth fields: ${JSON.stringify(parsed).slice(0, 4000)}`,
      )
    }

    return parsed
  } finally {
    if (sandbox) {
      try {
        await sandbox.delete()
      } catch (err) {
        console.error("[claude-credentials] sandbox.delete failed:", err)
      }
    }
  }
}
