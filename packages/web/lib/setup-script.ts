/**
 * Environment setup scripts: materialization, execution, and sync-back.
 *
 * The script is a real file in the sandbox rather than a string piped into a
 * command. That one choice is what makes the agent able to fix it (it edits a
 * file like any other) and what makes assisted setup work (it writes that file
 * from scratch) without any new tool surface for the agent to learn or forget.
 *
 * The file lives OUTSIDE the repo clone so no auto-commit or push flow picks it
 * up as an untracked file.
 */

import { createHash } from "crypto"
import type { Sandbox } from "@daytonaio/sdk"
import { createSandboxJobs, type JobHandle } from "@background-agents/sandbox-jobs"
// Pure constants and the assisted-setup prompt live in setup-paths.ts, which
// has no Node or sandbox-jobs imports, so a client component can pull in
// buildAssistedSetupPrompt without dragging this module's server-only
// dependencies into the browser bundle. Re-exported here too so anything
// that reaches for them via "@/lib/setup-script" still finds them.
export { SETUP_DIR, SETUP_SCRIPT_PATH, buildAssistedSetupPrompt } from "./setup-paths"
import { SETUP_DIR, SETUP_SCRIPT_PATH } from "./setup-paths"

/** Hard wall-clock cap. sandbox-jobs implements this with coreutils `timeout`,
 *  so an expiry surfaces as exit code 124, a real, observable code. */
export const SETUP_TIMEOUT_SECONDS = 600

/** Past this, it isn't a setup script any more; we ignore it rather than
 *  pulling an arbitrarily large file into the turn's memory. */
export const MAX_SETUP_SCRIPT_BYTES = 64 * 1024

/** Log lines handed to the agent when the script fails. */
export const SETUP_LOG_TAIL_LINES = 100

export interface SetupRunRecord {
  /**
   * Absent when there was no script to run (the environment's setup script is
   * empty). Never a fabricated placeholder: a record with no handle is only
   * ever valid outside the "running" state, since there is no job to poll.
   */
  handle?: JobHandle
  environmentId: string
  /** SHA-256 of the script as written into the sandbox. */
  writtenHash: string
  startedAt: number
  /** Set once the job has exited and been observed. */
  finishedAt?: number
  exitCode?: number | null
  state?: "running" | "exited" | "crashed"
  /**
   * When a dispatcher last claimed this run's exit, as a unix ms timestamp.
   *
   * The claim leaves the chat in `setting_up` on purpose: a chat moved to
   * `ready` before its turn actually starts is invisible to every recovery
   * path (the cron monitors `running`, phase 5 monitors `setting_up`, and the
   * stop endpoint needs a backgroundSessionId), so an invocation killed during
   * turn startup would strand it. Staying in `setting_up` keeps the chat
   * 409-busy to a second tab and lets the cron re-claim a stale one.
   */
  claimedAt?: number
}

export function hashScript(script: string): string {
  return createHash("sha256").update(script, "utf8").digest("hex")
}

/**
 * "The agent just edited the setup script" marker, written by
 * {@link syncSetupScript} onto the chat's own `setupRun` JSON as a sibling key
 * (see {@link withScriptUpdateNotice}) rather than a new column: it survives
 * everywhere `setupRun` already does, and it is the one thing both the
 * completion event and the chat's own row can carry without a schema change.
 *
 * `Environment.updatedAt` was tried for this first and rejected: sync-back
 * always runs before the chat's own row is bumped to `ready`, so comparing
 * two independently-drifting `updatedAt` columns has the ordering backwards.
 * A marker written by the exact code that made the edit has no ordering
 * dependency to get wrong.
 */
export interface ScriptUpdateNotice {
  /** Which environment's script changed. */
  environmentId: string
  /** Hash of the script that was saved. A dismissal is keyed to this, not just
   *  to the chat, so a *later* edit's notice is never swallowed by a
   *  dismissal of an earlier one. */
  scriptHash: string
  updatedAt: number
}

/** Reads the marker back off a chat's stored `setupRun` value, if present. */
export function readScriptUpdateNotice(value: unknown): ScriptUpdateNotice | null {
  if (!value || typeof value !== "object") return null
  const raw = (value as Record<string, unknown>).scriptUpdateNotice
  if (!raw || typeof raw !== "object") return null
  const n = raw as Partial<ScriptUpdateNotice>
  if (typeof n.environmentId !== "string") return null
  if (typeof n.scriptHash !== "string") return null
  if (typeof n.updatedAt !== "number") return null
  return { environmentId: n.environmentId, scriptHash: n.scriptHash, updatedAt: n.updatedAt }
}

/**
 * Merges a fresh marker into whatever is already stored in `setupRun`,
 * preserving any job-tracking fields already there (a chat's very first
 * script sync often runs moments after {@link SetupRunRecord} itself was
 * written) instead of clobbering them.
 */
export function withScriptUpdateNotice(
  existing: unknown,
  notice: ScriptUpdateNotice
): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {}
  return { ...base, scriptUpdateNotice: notice }
}

export function isSetupRunRecord(value: unknown): value is SetupRunRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<SetupRunRecord>
  if (typeof v.writtenHash !== "string") return false
  if (typeof v.environmentId !== "string") return false

  if (v.handle === undefined) {
    // No job was started (empty script). Valid only when nothing is claiming
    // to be running: there is no handle to poll, so "running" here would be a
    // lie no later reader could catch.
    return v.state !== "running"
  }

  return typeof (v.handle as JobHandle).jobId === "string"
}

export type SyncDecision =
  | { action: "skip"; reason: "no-environment" | "unreadable" | "too-large" | "unchanged" }
  | { action: "conflict" }
  | { action: "save"; script: string }

/**
 * Whether an agent's edit to the sandbox copy should be written back.
 *
 * The conflict branch is the one that matters: if the stored script has ALSO
 * moved off the hash we wrote, the user edited the environment while this chat
 * was running. Someone loses an edit either way, and silently clobbering a
 * deliberate user edit with an incidental agent one is the wrong default, so we
 * do nothing and surface it.
 */
export function decideSetupScriptSync(input: {
  environmentId: string | null
  writtenHash: string | null
  sandboxScript: string | null
  storedScript: string | null
}): SyncDecision {
  const { environmentId, writtenHash, sandboxScript, storedScript } = input

  if (!environmentId) return { action: "skip", reason: "no-environment" }
  if (sandboxScript === null) return { action: "skip", reason: "unreadable" }
  if (Buffer.byteLength(sandboxScript, "utf8") > MAX_SETUP_SCRIPT_BYTES) {
    return { action: "skip", reason: "too-large" }
  }
  // Nothing to compare against: treat as untouched rather than guessing.
  if (!writtenHash) return { action: "skip", reason: "unchanged" }
  if (hashScript(sandboxScript) === writtenHash) return { action: "skip", reason: "unchanged" }

  // The sandbox copy changed. Did the stored one change too?
  const storedHash = storedScript === null ? null : hashScript(storedScript)
  if (storedHash !== writtenHash) return { action: "conflict" }

  return { action: "save", script: sandboxScript }
}

/**
 * The system note appended to the agent's context when setup fails.
 *
 * Deliberately tells the agent the path: fixing the script is a legitimate and
 * often correct response, and the sync-back persists that fix.
 */
export function buildSetupFailureNote(exitCode: number | null, logTail: string): string {
  const what =
    exitCode === 124
      ? `timed out after ${SETUP_TIMEOUT_SECONDS / 60} minutes`
      : `failed with exit code ${exitCode ?? "unknown"}`

  return [
    `The environment setup script at ${SETUP_SCRIPT_PATH} ${what}.`,
    "",
    "Output (last lines):",
    logTail,
    "",
    "The project may be missing dependencies or services it expects. You can work",
    `around it, or fix ${SETUP_SCRIPT_PATH} directly, edits to that file are saved`,
    "back to the environment and reused for future sandboxes. Do not put secrets in",
    "the script; ask for them as environment variables instead.",
  ].join("\n")
}

/** Write the script into the sandbox and return the hash that was written. */
export async function writeSetupScript(sandbox: Sandbox, script: string): Promise<string> {
  await sandbox.process.executeCommand(`mkdir -p '${SETUP_DIR}'`)
  // Written via the filesystem API rather than a shell heredoc so no quoting or
  // escaping in the user's script can break out into the surrounding command.
  await sandbox.fs.uploadFile(Buffer.from(script, "utf8"), SETUP_SCRIPT_PATH)
  await sandbox.process.executeCommand(`chmod +x '${SETUP_SCRIPT_PATH}'`)
  return hashScript(script)
}

/** Start the setup script as a detached, reattachable job. */
export async function startSetupJob(
  sandbox: Sandbox,
  repoPath: string,
  env: Record<string, string>
): Promise<JobHandle> {
  const jobs = createSandboxJobs(sandbox)
  return jobs.start({
    command: `bash ${SETUP_SCRIPT_PATH}`,
    cwd: repoPath,
    env,
    timeoutSeconds: SETUP_TIMEOUT_SECONDS,
    processName: "backgrounder-setup",
  })
}

/** Read the sandbox's copy of the script, or null if it is gone or unreadable. */
export async function readSetupScriptFromSandbox(sandbox: Sandbox): Promise<string | null> {
  try {
    const bytes = await sandbox.fs.downloadFile(SETUP_SCRIPT_PATH)
    return Buffer.from(bytes).toString("utf8")
  } catch {
    return null
  }
}

/** Last N lines of a log, for the failure note and the UI. */
export function tailLines(text: string, lines = SETUP_LOG_TAIL_LINES): string {
  const all = text.split("\n")
  return all.slice(Math.max(0, all.length - lines)).join("\n")
}
