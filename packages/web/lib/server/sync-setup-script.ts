/**
 * Persist an agent's edits to the sandbox copy of the setup script.
 *
 * Runs after every turn, in both turn-completion paths (the live SSE handler
 * and the agent-lifecycle cron), best-effort: a failure here must never fail a
 * turn that otherwise succeeded.
 *
 * ONLY the script is ever read back out of the sandbox. Environment variables,
 * network mode, and the environment name are never sourced from sandbox state,
 * so nothing the agent writes to disk can become a stored secret or widen
 * network access.
 */

import type { Sandbox } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  decideSetupScriptSync,
  hashScript,
  isSetupRunRecord,
  readSetupScriptFromSandbox,
  withScriptUpdateNotice,
  type ScriptUpdateNotice,
  type SetupRunRecord,
} from "@/lib/setup-script"

export async function syncSetupScript(sandbox: Sandbox, chatId: string): Promise<
  | { result: "saved"; notice: ScriptUpdateNotice }
  | { result: "conflict" }
  | { result: "skipped"; reason: string }
> {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId },
    select: {
      id: true,
      environmentId: true,
      setupRun: true,
      environment: { select: { id: true, setupScript: true } },
    },
  })

  if (!chat?.environmentId || !chat.environment) {
    return { result: "skipped", reason: "no-environment" }
  }

  const record = isSetupRunRecord(chat.setupRun) ? (chat.setupRun as SetupRunRecord) : null
  const sandboxScript = await readSetupScriptFromSandbox(sandbox)

  const decision = decideSetupScriptSync({
    environmentId: chat.environmentId,
    writtenHash: record?.writtenHash ?? null,
    sandboxScript,
    // writeSetupScript writes "" for an environment whose script is null, so a
    // null column and an empty file are the same state. Normalizing here (not
    // in the pure function) keeps that storage detail out of the decision
    // rule.
    storedScript: chat.environment.setupScript ?? "",
  })

  if (decision.action === "skip") return { result: "skipped", reason: decision.reason }

  if (decision.action === "conflict") {
    console.warn(
      `[sync-setup-script] chat ${chatId}: sandbox script diverged from environment ${chat.environmentId}; not overwriting`
    )
    return { result: "conflict" }
  }

  await prisma.environment.update({
    where: { id: chat.environmentId },
    data: {
      setupScript: decision.script,
      setupScriptPrevious: chat.environment.setupScript,
      setupScriptUpdatedBy: "agent",
    },
  })

  const scriptHash = hashScript(decision.script)
  const notice: ScriptUpdateNotice = {
    environmentId: chat.environmentId,
    scriptHash,
    updatedAt: Date.now(),
  }

  // Always stamp the notice marker, even when this chat never had a job
  // record of its own (e.g. its sandbox already existed before Part 2). When
  // a record IS there, advance its written hash in the same write so the next
  // turn sees an unchanged file rather than re-saving the same content and
  // burning a revision every turn.
  await prisma.chat.update({
    where: { id: chatId },
    data: {
      setupRun: withScriptUpdateNotice(
        record ? { ...record, writtenHash: scriptHash } : chat.setupRun,
        notice
      ) as never,
    },
  })

  return { result: "saved", notice }
}
