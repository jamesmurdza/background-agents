/**
 * Session metadata persistence.
 *
 * Background sessions persist a small `meta.json` in the session directory so a
 * turn can be polled, reattached, and resumed across processes. This module
 * owns reading/writing that file and comparing meta for change-detection.
 */

import type { CodeAgentSandbox } from "../types/provider"
import type { SessionMeta } from "./types"
import { debugLog } from "../debug"

/** Path to the meta file for a session directory. */
function metaPath(sessionDir: string): string {
  return `${sessionDir}/meta.json`
}

/** Validate the minimally-required numeric fields of a parsed meta object. */
function isValidMeta(o: unknown): o is SessionMeta {
  return (
    typeof o === "object" &&
    o !== null &&
    typeof (o as SessionMeta).currentTurn === "number" &&
    typeof (o as SessionMeta).cursor === "number"
  )
}

/**
 * Parse a raw `meta.json` string into a {@link SessionMeta}, or null if it is
 * empty/invalid. A parse failure is logged via debugLog rather than swallowed.
 */
export function parseMeta(raw: string | undefined | null): SessionMeta | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  try {
    const o = JSON.parse(trimmed)
    return isValidMeta(o) ? o : null
  } catch (err) {
    debugLog("meta-store parse failed", String(err))
    return null
  }
}

/** Read and parse the session meta file. */
export async function readMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string
): Promise<SessionMeta | null> {
  if (!sandbox.executeCommand) return null
  const result = await sandbox.executeCommand(
    `cat "${metaPath(sessionDir)}" 2>/dev/null || true`,
    10
  )
  return parseMeta(result.output)
}

/** Write the session meta file (base64-encoded to survive shell quoting). */
export async function writeMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  meta: SessionMeta
): Promise<void> {
  if (!sandbox.executeCommand) {
    throw new Error(
      "Sandbox background mode requires a sandbox with executeCommand support"
    )
  }
  const json = JSON.stringify(meta)
  const b64 = Buffer.from(json, "utf8").toString("base64")
  await sandbox.executeCommand(
    `mkdir -p "${sessionDir}" && echo '${b64}' | base64 -d > "${metaPath(sessionDir)}"`,
    10
  )
}

/** True if `next` is field-for-field equal to `prev` for the persisted fields. */
export function metaUnchanged(prev: SessionMeta, next: SessionMeta): boolean {
  return (
    prev.currentTurn === next.currentTurn &&
    prev.cursor === next.cursor &&
    (prev.rawCursor ?? 0) === (next.rawCursor ?? 0) &&
    prev.pid === next.pid &&
    prev.runId === next.runId &&
    prev.outputFile === next.outputFile &&
    (prev.sawEnd ?? false) === (next.sawEnd ?? false) &&
    prev.startedAt === next.startedAt &&
    prev.provider === next.provider &&
    (prev.sessionId ?? null) === (next.sessionId ?? null)
  )
}

/**
 * Write initial session metadata for reattachment.
 */
export async function writeInitialSessionMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string,
  agentName: string,
  sessionId: string | null
): Promise<void> {
  if (!sandbox.executeCommand) return
  await writeMeta(sandbox, sessionDir, {
    currentTurn: 0,
    cursor: 0,
    provider: agentName,
    sessionId,
  })
}

/**
 * Read provider name and session id from session metadata.
 */
export async function readProviderFromMeta(
  sandbox: CodeAgentSandbox,
  sessionDir: string
): Promise<{ provider: string | null; sessionId: string | null } | null> {
  if (!sandbox.executeCommand) return null
  const result = await sandbox.executeCommand(
    `cat "${metaPath(sessionDir)}" 2>/dev/null || true`,
    10
  )
  const raw = (result.output ?? "").trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { provider?: string; sessionId?: string | null }
    return {
      provider: o.provider ?? null,
      sessionId: o.sessionId ?? null,
    }
  } catch (err) {
    debugLog("meta-store readProvider parse failed", String(err))
    return { provider: null, sessionId: null }
  }
}
