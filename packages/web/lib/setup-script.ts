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

export const SETUP_DIR = "/home/daytona/.backgrounder"
export const SETUP_SCRIPT_PATH = `${SETUP_DIR}/setup.sh`

/** Hard wall-clock cap. sandbox-jobs implements this with coreutils `timeout`,
 *  so an expiry surfaces as exit code 124, a real, observable code. */
export const SETUP_TIMEOUT_SECONDS = 600

/** Past this, it isn't a setup script any more; we ignore it rather than
 *  pulling an arbitrarily large file into the turn's memory. */
export const MAX_SETUP_SCRIPT_BYTES = 64 * 1024

/** Log lines handed to the agent when the script fails. */
export const SETUP_LOG_TAIL_LINES = 100

export interface SetupRunRecord {
  handle: JobHandle
  environmentId: string
  /** SHA-256 of the script as written into the sandbox. */
  writtenHash: string
  startedAt: number
  /** Set once the job has exited and been observed. */
  finishedAt?: number
  exitCode?: number | null
  state?: "running" | "exited" | "crashed"
}

export function hashScript(script: string): string {
  return createHash("sha256").update(script, "utf8").digest("hex")
}

export function isSetupRunRecord(value: unknown): value is SetupRunRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<SetupRunRecord>
  return (
    typeof v.writtenHash === "string" &&
    typeof v.environmentId === "string" &&
    !!v.handle &&
    typeof (v.handle as JobHandle).jobId === "string"
  )
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
  await sandbox.process.executeCommand(`mkdir -p ${SETUP_DIR}`)
  // Written via the filesystem API rather than a shell heredoc so no quoting or
  // escaping in the user's script can break out into the surrounding command.
  await sandbox.fs.uploadFile(Buffer.from(script, "utf8"), SETUP_SCRIPT_PATH)
  await sandbox.process.executeCommand(`chmod +x ${SETUP_SCRIPT_PATH}`)
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
