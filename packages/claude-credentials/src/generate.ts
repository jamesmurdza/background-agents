import { Daytona, Image, type Sandbox } from "@daytonaio/sdk"
import type { ClaudeOAuthCredentials } from "./types"

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
 * Pinned ccauth commit used to build the sandbox image.
 *
 * We deliberately pin instead of resolving `master` on every run. The generator
 * runs on an hourly cron, and resolving the latest SHA hit the unauthenticated
 * GitHub API rate limit (60 req/h per IP → HTTP 403), which surfaced as
 * `REFRESH_FAILED` and blocked credential refresh entirely.
 *
 * To adopt a newer ccauth commit, bump this to the desired SHA — e.g. run
 * `resolveLatestCCAuthSha()` (or `git ls-remote https://github.com/${CCAUTH_REPO}
 * master`) and paste its output here. Changing this value changes the Image spec
 * hash, so Daytona rebuilds the snapshot on the next run and picks up the fix.
 */
export const CCAUTH_PINNED_SHA = "59d36167e65f9d49724049a8d4aee72c3f9585e3"

/**
 * Resolves the latest commit SHA on `master` via the GitHub API.
 *
 * NOTE: this is no longer called on the hot path — the generator uses the pinned
 * {@link CCAUTH_PINNED_SHA} to avoid hammering the (rate-limited) GitHub API on
 * every cron run. Keep this as a manual helper for finding the SHA to pin when
 * bumping ccauth.
 */
export async function resolveLatestCCAuthSha(): Promise<string> {
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

/**
 * Builds the Daytona Image spec for running ccauth.
 *
 * `refreshMode` returns a lightweight image for `ccauth --refresh` (a plain HTTP
 * call, no browser): it drops the heavy X/Chrome layers, keeping just git for
 * the `git+https@sha` pip install — so the snapshot builds in seconds.
 */
export function getCCAuthImage(sha: string, refreshMode = false): Image {
  const baseImage = Image.debianSlim("3.12")
  const pipPackages = [`git+https://github.com/${CCAUTH_REPO}.git@${sha}`]
  if (refreshMode) {
    return baseImage
      .runCommands(
        "apt-get update && apt-get install -y --no-install-recommends git " +
          "&& rm -rf /var/lib/apt/lists/*",
      )
      .pipInstall(pipPackages)
  }
  return baseImage
    .runCommands(
      "apt-get update && apt-get install -y --no-install-recommends " +
        "git xvfb xauth x11vnc novnc xfce4 xfce4-terminal dbus-x11 " +
        "&& rm -rf /var/lib/apt/lists/*",
    )
    .pipInstall(pipPackages)
    .runCommands("patchright install --with-deps chrome")
    .workdir("/home/daytona")
}

/**
 * Type guard for ClaudeOAuthCredentials
 */
export function isClaudeOAuthCredentials(
  value: unknown,
): value is ClaudeOAuthCredentials {
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
 * Thrown when ccauth reports the refresh token itself is expired/revoked (its
 * error JSON carries `refresh_expired`). Callers should fall back to the full
 * cookie-based OAuth flow (generateClaudeCredentials).
 */
export class RefreshTokenExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RefreshTokenExpiredError"
  }
}

/**
 * Parses ccauth's final stdout line. ccauth always emits a single-line JSON:
 * {"claudeAiOauth": {...}} on success, or {"error": ..., extra} on failure.
 * Daytona merges stdout+stderr and ccauth prints its JSON last, so we take the
 * final non-empty line. Throws RefreshTokenExpiredError when the failure carries
 * `refresh_expired` so callers can fall back to the full OAuth flow.
 */
function parseCredentialsOutput(output: string): ClaudeOAuthCredentials {
  const lastLine = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  if (!lastLine) throw new Error("ccauth produced empty output")

  let parsed: unknown
  try {
    parsed = JSON.parse(lastLine)
  } catch {
    throw new Error(
      `ccauth produced non-JSON final line: ${lastLine.slice(0, 4000)}`,
    )
  }

  if (isClaudeOAuthCredentials(parsed)) return parsed

  const err = parsed as { error?: unknown; refresh_expired?: unknown }
  if (err && typeof err.error === "string") {
    if (err.refresh_expired === true) {
      throw new RefreshTokenExpiredError(err.error.slice(0, 500))
    }
    throw new Error(`ccauth error: ${err.error.slice(0, 4000)}`)
  }

  throw new Error(
    `ccauth output missing claudeAiOauth fields: ${JSON.stringify(parsed).slice(0, 4000)}`,
  )
}

export interface GenerateCredentialsOptions {
  /** Daytona API key. If not provided, reads from DAYTONA_API_KEY env var. */
  apiKey?: string
}

/**
 * Provisions an ephemeral Daytona sandbox and returns the parsed credential JSON.
 *
 * - `{ cookies }` runs the full browser OAuth flow (`ccauth --cookies`) in the
 *   heavy image, mounting the persistent patchright profile volume so Cloudflare
 *   Turnstile trust accumulates across runs. Use on first run or when the
 *   refresh token has expired.
 * - `{ refreshToken }` renews from an existing refresh token (`ccauth --refresh`)
 *   in the lightweight image — a plain HTTP call, no browser, no volume. This is
 *   the common path. Throws {@link RefreshTokenExpiredError} when the refresh
 *   token is rejected, so callers can fall back to the `{ cookies }` form.
 */
export function generateClaudeCredentials(
  input: { cookies: string },
  options?: GenerateCredentialsOptions,
): Promise<ClaudeOAuthCredentials>
export function generateClaudeCredentials(
  input: { refreshToken: string },
  options?: GenerateCredentialsOptions,
): Promise<ClaudeOAuthCredentials>
export async function generateClaudeCredentials(
  input: { cookies: string } | { refreshToken: string },
  options: GenerateCredentialsOptions = {},
): Promise<ClaudeOAuthCredentials> {
  const apiKey = options.apiKey ?? process.env.DAYTONA_API_KEY
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set")

  const refreshMode = "refreshToken" in input
  // Use the pinned SHA rather than resolving `master` per run: the hourly cron
  // otherwise exhausts the unauthenticated GitHub API rate limit (see
  // CCAUTH_PINNED_SHA). Bump that constant to roll ccauth forward.
  const ccauthSha = CCAUTH_PINNED_SHA
  console.error(
    `[claude-credentials] using ccauth (${refreshMode ? "refresh" : "cookie-based"} flow) ${ccauthSha.slice(0, 12)}`,
  )
  const ccauthImage = getCCAuthImage(ccauthSha, refreshMode)

  const daytona = new Daytona({ apiKey })

  // Cookie mode mounts a persistent patchright profile volume so Cloudflare
  // Turnstile trust accumulates across runs; refresh mode needs no browser
  // profile. volume.get(..., true) creates on first run but comes back in
  // `pending_create` state; mounting before it's `ready` 400s, so poll first.
  let volumes: { volumeId: string; mountPath: string }[] | undefined
  if (!refreshMode) {
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
    volumes = [{ volumeId: volume.id, mountPath: PATCHRIGHT_PROFILE_PATH }]
  }

  let sandbox: Sandbox | undefined
  try {
    sandbox = await daytona.create(
      {
        image: ccauthImage,
        ephemeral: true,
        volumes,
        autoStopInterval: 5,
      },
      {
        timeout: 0,
        onSnapshotCreateLogs: (chunk) =>
          console.error(`[ccauth-snapshot] ${chunk}`),
      },
    )

    if (!refreshMode) {
      await sandbox.fs.uploadFile(
        Buffer.from(input.cookies, "utf8"),
        COOKIES_REMOTE_PATH,
      )
    }

    // ccauth always emits JSON on stdout: {"claudeAiOauth": {...}} on success
    // (exit 0) or {"error": ..., extra} on failure (exit 1); verbose logs go to
    // stderr. Cookie mode runs Chrome headed under xvfb-run (Turnstile flags
    // headless); refresh mode is a plain HTTP call with the token passed via env
    // (not argv) so it stays out of the command string.
    const res =
      refreshMode
        ? await sandbox.process.executeCommand(
            `ccauth --refresh "$CCAUTH_REFRESH_TOKEN"`,
            undefined,
            { CCAUTH_REFRESH_TOKEN: input.refreshToken },
            120,
          )
        : await sandbox.process.executeCommand(
            `xvfb-run -a ccauth --cookies $COOKIES_PATH`,
            undefined,
            { COOKIES_PATH: COOKIES_REMOTE_PATH },
            300,
          )

    return parseCredentialsOutput(res.result ?? "")
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
