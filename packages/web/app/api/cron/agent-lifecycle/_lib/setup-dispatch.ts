import type { Daytona } from "@daytonaio/sdk"
import { createSandboxJobs } from "@background-agents/sandbox-jobs"

import { prisma } from "@/lib/db/prisma"
import { ensureSandboxStarted, isSandboxGoneError } from "@/lib/sandbox"
import { isSetupRunRecord, tailLines, type SetupRunRecord } from "@/lib/setup-script"
import {
  dispatchQueuedTurn,
  finishSetupRecord,
  DISPATCH_CLAIM_TTL_MS,
} from "@/lib/server/dispatch-setup-turn"

export interface SetupDispatchResults {
  dispatchedAfterSetup: number
  errors: string[]
}

/**
 * Cron phase 5: dispatch turns held by a setup script that has finished.
 *
 * Lifted out of the route body so both of its give-up decisions can be tested
 * directly: which failures are terminal for a chat, and which are transient and
 * must leave it in `setting_up` for the next tick.
 */
export async function dispatchFinishedSetups(
  daytona: Daytona,
  now: Date,
  results: SetupDispatchResults
): Promise<void> {
  // The /setup SSE endpoint normally does this; this covers a client that
  // disconnected. Polling here is also what keeps a watched-then-abandoned
  // sandbox from hitting autoStopInterval mid-script, since every status
  // check is sandbox activity.
  //
  // It is also the recovery path for a dispatch that was claimed and then
  // killed: the claim leaves the chat in `setting_up` and only stamps
  // `claimedAt`, so a claim older than DISPATCH_CLAIM_TTL_MS is retried here.
  const settingUp = await prisma.chat.findMany({
    where: { status: "setting_up" },
    select: { id: true, userId: true, sandboxId: true, setupRun: true },
  })

  for (const chat of settingUp) {
    try {
      // A setting_up chat whose record is unusable can never leave that
      // state on its own, and POST /messages answers 409 for it. Surface it
      // rather than skipping it silently every tick.
      if (!isSetupRunRecord(chat.setupRun) || !chat.sandboxId) {
        results.errors.push(`setup dispatch ${chat.id}: stuck in setting_up with no usable setup run`)
        continue
      }
      const record = chat.setupRun as SetupRunRecord

      // No handle means no job was ever started, so there is nothing to poll
      // and nothing failed. Unstick the chat instead of leaving it here every
      // tick forever.
      if (!record.handle) {
        const dispatched = await dispatchQueuedTurn({
          chatId: chat.id,
          userId: chat.userId,
          setupRun: { ...record, state: "exited", exitCode: 0, finishedAt: Date.now() },
          logTail: "",
        })
        if (dispatched) results.dispatchedAfterSetup++
        continue
      }

      // Another observer is mid-dispatch. Leave it alone until its claim
      // goes stale; dispatchQueuedTurn would refuse it anyway, and this
      // saves the Daytona round trips.
      if (record.claimedAt && now.getTime() - record.claimedAt < DISPATCH_CLAIM_TTL_MS) {
        continue
      }

      let sandbox
      try {
        sandbox = await daytona.get(chat.sandboxId)
      } catch (err) {
        // Only a sandbox that genuinely no longer exists (cleanup cron, or the
        // 4-day auto-delete) is unrecoverable: there is no job left to observe,
        // and no way for this chat to leave `setting_up` on its own, where it
        // would 409 every send and re-fail here every minute. Fail that one.
        if (!isSandboxGoneError(err)) {
          // Anything else is upstream weather: a 5xx, a network timeout, a
          // rotated API key. Rethrowing leaves the chat in `setting_up` for the
          // next tick, which is exactly what the ensureSandboxStarted call below
          // already does by falling to the same catch. Giving up here instead
          // would discard every in-flight setup in the system on one bad minute.
          throw err
        }
        await prisma.chat.update({ where: { id: chat.id }, data: { status: "error" } })
        results.errors.push(
          `setup dispatch ${chat.id}: sandbox no longer exists, chat marked error (${err instanceof Error ? err.message : "unknown"})`
        )
        continue
      }

      // A stopped sandbox cannot be polled, and the turn we are about to
      // dispatch needs it started anyway.
      await ensureSandboxStarted(sandbox)

      const jobs = createSandboxJobs(sandbox)
      const status = await jobs.status(record.handle)
      if (status.alive) continue

      const read = await jobs.read(record.handle, 0)
      const dispatched = await dispatchQueuedTurn({
        chatId: chat.id,
        userId: chat.userId,
        setupRun: finishSetupRecord(record, status),
        logTail: tailLines(read.raw),
      })
      if (dispatched) results.dispatchedAfterSetup++
    } catch (err) {
      results.errors.push(
        `setup dispatch ${chat.id}: ${err instanceof Error ? err.message : "unknown"}`
      )
    }
  }
}
