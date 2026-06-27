import { Daytona } from "@daytonaio/sdk"
import {
  getAgentSandboxImage,
  SNAPSHOT_NAME,
  SNAPSHOT_NAME_TEMP,
  SNAPSHOT_RESOURCES,
} from "./image"

export interface RebuildSnapshotOptions {
  /** Receives progress and image-build log lines. */
  onLog?: (line: string) => void
}

/** Snapshot state meaning "built and ready". Mirrors image.ts. */
const SNAPSHOT_STATE_ACTIVE = "active"

/** Returns the snapshot if it exists, else undefined (get() throws when absent). */
async function getSnapshotIfExists(daytona: Daytona, name: string) {
  try {
    return await daytona.snapshot.get(name)
  } catch {
    return undefined
  }
}

/**
 * Deletes a snapshot by name if it exists and waits until the name is free.
 * Daytona deletion is asynchronous, so we poll until get() reports it gone.
 */
async function deleteSnapshotAndWait(
  daytona: Daytona,
  name: string,
  onLog?: (line: string) => void
): Promise<void> {
  const existing = await getSnapshotIfExists(daytona, name)
  if (!existing) return

  onLog?.(`Deleting snapshot "${name}"...`)
  await daytona.snapshot.delete(existing)

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (!(await getSnapshotIfExists(daytona, name))) return // gone
    await new Promise((r) => setTimeout(r, 3_000))
  }
  throw new Error(`Timed out waiting for snapshot "${name}" to be deleted`)
}

/**
 * Builds a snapshot and resolves once it is ready. `create()` already resolves
 * on completion, but we verify the `active` state defensively before treating
 * it as servable (a not-ready snapshot must never become the active one).
 */
async function buildSnapshot(
  daytona: Daytona,
  name: string,
  onLog?: (line: string) => void
) {
  onLog?.(`Building snapshot "${name}" (this can take several minutes)...`)
  const snapshot = await daytona.snapshot.create(
    {
      name,
      image: getAgentSandboxImage(),
      resources: SNAPSHOT_RESOURCES,
    },
    onLog ? { onLogs: onLog } : undefined
  )

  if (snapshot.state !== SNAPSHOT_STATE_ACTIVE) {
    throw new Error(
      `Snapshot "${name}" finished building in state "${snapshot.state}" (expected "${SNAPSHOT_STATE_ACTIVE}")`
    )
  }
  return snapshot
}

/**
 * Zero-downtime rebuild of the canonical agent-sandbox snapshot.
 *
 * The app always serves the snapshot named SNAPSHOT_NAME; SNAPSHOT_NAME_TEMP is
 * transient scratch space that exists only mid-rebuild. Because the app's
 * getActiveSnapshotName() only serves snapshots in the `active` state, there is
 * always exactly one ready snapshot for new sandboxes to launch from:
 *
 *   0. Delete any leftover temp from a previously failed run (self-heals).
 *   1. First run (no canonical snapshot yet) → build it directly and stop.
 *   2. Build temp                  → canonical still active & serving.
 *   3. Delete canonical            → temp is now the only active one, serving.
 *   4. Rebuild canonical           → "building" (invisible); temp serves.
 *                                     once ready it becomes active again.
 *   5. Delete temp                 → steady state: only canonical remains.
 *
 * Note: deleting a snapshot does not affect sandboxes already created from it;
 * it only governs which snapshot new sandboxes launch from.
 *
 * Intended to be run manually (`npm run build:snapshot`); it runs two serial
 * image builds, so it is not bounded by a typical serverless cron timeout.
 */
export async function rebuildSnapshot(
  daytona: Daytona,
  options: RebuildSnapshotOptions = {}
): Promise<Awaited<ReturnType<typeof buildSnapshot>>> {
  const { onLog } = options

  // 0. Clean up a stale temp snapshot from any previous failed rebuild so the
  //    build in step 2 can't fail on a taken name.
  await deleteSnapshotAndWait(daytona, SNAPSHOT_NAME_TEMP, onLog)

  // 1. First run: nothing to protect, build the canonical snapshot directly.
  const canonical = await getSnapshotIfExists(daytona, SNAPSHOT_NAME)
  if (!canonical) {
    onLog?.(`No existing "${SNAPSHOT_NAME}" — building it directly.`)
    return buildSnapshot(daytona, SNAPSHOT_NAME, onLog)
  }

  // 2. Build temp while the canonical snapshot keeps serving.
  await buildSnapshot(daytona, SNAPSHOT_NAME_TEMP, onLog)

  // 3. Delete the canonical snapshot — temp is now the only active one.
  await deleteSnapshotAndWait(daytona, SNAPSHOT_NAME, onLog)

  // 4. Rebuild the canonical snapshot fresh; temp serves until it's ready.
  const rebuilt = await buildSnapshot(daytona, SNAPSHOT_NAME, onLog)

  // 5. Remove temp — steady state is just the canonical snapshot.
  await deleteSnapshotAndWait(daytona, SNAPSHOT_NAME_TEMP, onLog)

  return rebuilt
}
