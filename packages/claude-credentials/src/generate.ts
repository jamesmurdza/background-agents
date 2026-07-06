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

// Prefix for the named, persistent Daytona snapshot we build ccauth into. The
// full name is suffixed with the ccauth commit SHA so a new ccauth release
// naturally produces a new snapshot (see getCCAuthSnapshotName).
const SNAPSHOT_NAME_PREFIX = "ccauth"

// How long to wait for a concurrent snapshot build to finish before giving up
// and rebuilding it ourselves.
const SNAPSHOT_BUILD_TIMEOUT_MS = 10 * 60 * 1000
const SNAPSHOT_POLL_INTERVAL_MS = 2000
// Deletion is asynchronous: a deleted snapshot sits in `removing` for a bit
// before its name is free again. Recreating with the same name before then 409s,
// so we wait this long for the record to disappear.
const SNAPSHOT_DELETE_TIMEOUT_MS = 60 * 1000

// Substrings Daytona surfaces when a sandbox references a snapshot whose backing
// registry image has been garbage-collected. The control plane still has the
// snapshot *metadata* (so it won't rebuild on its own), but the runner daemon
// can't pull the image, so the sandbox goes straight to `error`:
//   "failed to start with status: error, error reason: Error response from
//    daemon: pull access denied for daytona-<hash> ... repository does not
//    exist or may require 'docker login'"
const STALE_IMAGE_ERROR_FRAGMENTS = [
  "pull access denied",
  "repository does not exist",
  "docker login",
]

/** True when an error looks like a pruned/missing snapshot image (see above). */
function isStaleImageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return STALE_IMAGE_ERROR_FRAGMENTS.some((fragment) => msg.includes(fragment))
}

/**
 * Resolves the latest commit SHA on `master` so the pip install command becomes
 * `git+...@<sha>`. When the SHA changes, the Image spec hash changes, and
 * Daytona rebuilds the snapshot — picking up any ccauth fix automatically
 * without manual SHA bumps.
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
 */
export function getCCAuthImage(sha: string): Image {
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

/**
 * Deterministic name for the persistent ccauth snapshot. Keyed on the ccauth
 * commit SHA so a new ccauth release rebuilds automatically, while repeated runs
 * against the same release reuse one long-lived snapshot.
 */
export function getCCAuthSnapshotName(sha: string): string {
  return `${SNAPSHOT_NAME_PREFIX}-${sha.slice(0, 12)}`
}

/**
 * Ensures a usable (`active`) snapshot named `name` exists, building it from
 * `image` when it is missing, mid-flight, or in a failed/pruned state.
 *
 * Why a *named* snapshot instead of passing the declarative `Image` straight to
 * `daytona.create()`: an inline image is registered as an anonymous
 * `daytona-<hash>` snapshot that Daytona garbage-collects once nothing has used
 * it for a while. The control plane keeps the metadata but the registry blob is
 * pruned, so a later `create()` tries to *pull* an image that no longer exists
 * and the sandbox fails to start ("pull access denied ... repository does not
 * exist"). A named snapshot is a first-class object we can look up and
 * deterministically rebuild, so a prune becomes a self-healing rebuild instead
 * of a hard failure.
 *
 * @param rebuild - When true, delete any existing snapshot and rebuild from
 *   scratch. Used to recover after a prune is detected at sandbox-create time.
 */
export async function ensureCCAuthSnapshot(
  daytona: Daytona,
  name: string,
  image: Image,
  { rebuild = false }: { rebuild?: boolean } = {},
): Promise<void> {
  let existing: Awaited<ReturnType<typeof daytona.snapshot.get>> | undefined
  try {
    existing = await daytona.snapshot.get(name)
  } catch {
    // Not found (or unreadable) — treat as missing and build below.
    existing = undefined
  }

  if (existing && !rebuild) {
    if (existing.state === "active") return

    // Reuse an in-flight build kicked off by a concurrent run rather than
    // racing it with a second build of the same name.
    if (
      existing.state === "building" ||
      existing.state === "pending" ||
      existing.state === "pulling"
    ) {
      const deadline = Date.now() + SNAPSHOT_BUILD_TIMEOUT_MS
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_INTERVAL_MS))
        const snap = await daytona.snapshot.get(name)
        if (snap.state === "active") return
        if (snap.state !== "building" && snap.state !== "pending" && snap.state !== "pulling") {
          existing = snap
          break // Fell into a terminal/failed state — rebuild below.
        }
      }
    }
  }

  // Delete a stale/failed/pruned snapshot so create() can register a fresh one;
  // a lingering record with the same name would otherwise 409.
  if (existing) {
    console.error(
      `[claude-credentials] rebuilding snapshot ${name} (was '${existing.state}')`,
    )
    // `removing` means a delete is already in flight — don't re-issue it.
    if (existing.state !== "removing") {
      try {
        await daytona.snapshot.delete(existing)
      } catch (err) {
        console.error("[claude-credentials] snapshot.delete failed:", err)
      }
    }
    // Deletion is async: wait for the name to free up before recreating, or
    // create() 409s with "already exists".
    if (!(await waitForSnapshotGone(daytona, name))) {
      console.error(
        `[claude-credentials] snapshot ${name} still not gone after ${SNAPSHOT_DELETE_TIMEOUT_MS}ms; attempting build anyway`,
      )
    }
  } else {
    console.error(`[claude-credentials] building snapshot ${name}`)
  }

  // Build. Retry once on a name conflict: that means an old record was still
  // being deleted (or a concurrent run is mid-build) — wait for it to settle and
  // try again, accepting an active snapshot a concurrent builder may have won.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await daytona.snapshot.create(
        { name, image },
        {
          timeout: 0,
          onLogs: (chunk) => console.error(`[ccauth-image] ${chunk}`),
        },
      )
      return
    } catch (err) {
      const snap = await daytona.snapshot.get(name).catch(() => undefined)
      if (snap?.state === "active") return // Concurrent builder produced it.

      const msg = err instanceof Error ? err.message : String(err)
      const isConflict =
        msg.includes("already exists") ||
        (err as { statusCode?: number })?.statusCode === 409
      if (isConflict && attempt < 2) {
        console.error(
          `[claude-credentials] snapshot ${name} create conflicted (record still clearing); waiting and retrying`,
        )
        await waitForSnapshotGone(daytona, name)
        continue
      }
      throw err
    }
  }
}

/**
 * Polls until the named snapshot no longer exists (get 404s). Returns true when
 * it's gone, false if the deadline passes first (still `removing`).
 */
async function waitForSnapshotGone(
  daytona: Daytona,
  name: string,
): Promise<boolean> {
  const deadline = Date.now() + SNAPSHOT_DELETE_TIMEOUT_MS
  for (;;) {
    const snap = await daytona.snapshot.get(name).catch(() => undefined)
    if (!snap) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_INTERVAL_MS))
  }
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

export interface GenerateCredentialsOptions {
  /** Daytona API key. If not provided, reads from DAYTONA_API_KEY env var. */
  apiKey?: string
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
  options: GenerateCredentialsOptions = {},
): Promise<ClaudeOAuthCredentials> {
  const apiKey = options.apiKey ?? process.env.DAYTONA_API_KEY
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set")

  const ccauthSha = await resolveLatestCCAuthSha()
  console.error(`[claude-credentials] using ccauth ${ccauthSha.slice(0, 12)}`)
  const ccauthImage = getCCAuthImage(ccauthSha)
  const snapshotName = getCCAuthSnapshotName(ccauthSha)

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

  // Build (or reuse) the persistent named snapshot before creating a sandbox
  // from it. See ensureCCAuthSnapshot for why we don't pass the inline image.
  await ensureCCAuthSnapshot(daytona, snapshotName, ccauthImage)

  let sandbox: Sandbox | undefined
  try {
    const createSandbox = () =>
      daytona.create(
        {
          snapshot: snapshotName,
          ephemeral: true,
          volumes: [{ volumeId: volume.id, mountPath: PATCHRIGHT_PROFILE_PATH }],
          autoStopInterval: 5,
        },
        // Note: the SDK's snapshot-based create() overload only accepts
        // `{ timeout }` — `onSnapshotCreateLogs` exists solely on the
        // image-based overload and is rejected here by the type system. No build
        // happens on this path anyway; the image build logs (same `[ccauth-image]`
        // prefix) are streamed via snapshot.create's `onLogs` in
        // ensureCCAuthSnapshot, so no log output is lost.
        //
        // No client-side timeout: starting from a cold snapshot can occasionally
        // exceed the SDK's 60s default; the cron route's maxDuration is the real
        // ceiling. A genuine start failure still surfaces via the `error` state.
        { timeout: 0 },
      )

    try {
      sandbox = await createSandbox()
    } catch (err) {
      // The snapshot passed our `active` check but its backing image was pruned
      // between then and now (or was already a dangling record). Rebuild it once
      // and retry, turning a hard failure into a self-healing recovery.
      if (!isStaleImageError(err)) throw err
      console.error(
        `[claude-credentials] sandbox start hit a pruned image; rebuilding snapshot ${snapshotName} and retrying`,
      )
      await ensureCCAuthSnapshot(daytona, snapshotName, ccauthImage, {
        rebuild: true,
      })
      sandbox = await createSandbox()
    }

    await sandbox.fs.uploadFile(
      Buffer.from(cookies, "utf8"),
      COOKIES_REMOTE_PATH,
    )

    // ccauth runs Chrome headed (Turnstile flags headless). xvfb-run spins up a
    // throwaway X display, sets DISPLAY for ccauth, and tears it down on exit.
    // ccauth always emits JSON on stdout: {"claudeAiOauth": {...}} on success
    // (exit 0) or {"error": ..., extra} on failure (exit 1). Verbose logs go
    // to stderr.
    //
    // IMPORTANT: clear the persistent profile's cookie database before running
    // ccauth. The patchright profile at ~/.ccauth/patchright-profile accumulates
    // cookies across runs — after the first successful OAuth flow, patchright
    // saves cookies Claude set during authorization into the profile. On the
    // next run, those stale cookies load into the browser context BEFORE our
    // fresh cookies are injected, causing conflicts that make the OAuth flow
    // fail (Timed out waiting for OAuth callback). Deleting just the cookie
    // database preserves the Turnstile trust signals (localStorage, fingerprint,
    // browser cache) while ensuring a clean cookie injection every time.
    const COOKIES_DB_PATH = `${PATCHRIGHT_PROFILE_PATH}/Default/Cookies`
    const COOKIES_JOURNAL_PATH = `${PATCHRIGHT_PROFILE_PATH}/Default/Cookies-journal`
    const res = await sandbox.process.executeCommand(
      `rm -f ${COOKIES_DB_PATH} ${COOKIES_JOURNAL_PATH} && xvfb-run -a ccauth --cookies ${COOKIES_REMOTE_PATH}`,
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
