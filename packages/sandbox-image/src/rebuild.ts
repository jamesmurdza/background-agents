import { Daytona } from "@daytonaio/sdk"
import {
  getAgentSandboxImage,
  SNAPSHOT_NAME,
  SNAPSHOT_NAME_TEMP,
  ALL_SNAPSHOT_NAMES,
  SNAPSHOT_RESOURCES,
} from "./image"

export interface RebuildSnapshotOptions {
  /**
   * Delete an existing snapshot of the same name before recreating it.
   * Deletion is asynchronous, so this waits until the name is free.
   * Disabled by default — Daytona rejects `create` if the name is taken,
   * so only enable this when an intentional rebuild is desired.
   */
  deleteFirst?: boolean
  /** Receives progress and image-build log lines. */
  onLog?: (line: string) => void
}

/**
 * Builds (or rebuilds) the named Daytona snapshot used for agent sandboxes.
 */
export async function rebuildSnapshot(
  daytona: Daytona,
  options: RebuildSnapshotOptions = {}
) {
  const { deleteFirst = false, onLog } = options

  if (deleteFirst) {
    try {
      const existing = await daytona.snapshot.get(SNAPSHOT_NAME)
      onLog?.(`Deleting existing snapshot "${SNAPSHOT_NAME}"...`)
      await daytona.snapshot.delete(existing)

      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        try {
          await daytona.snapshot.get(SNAPSHOT_NAME)
          await new Promise((r) => setTimeout(r, 3_000))
        } catch {
          break // get() throws once the snapshot is gone
        }
      }
    } catch {
      // No existing snapshot — first build.
    }
  }

  onLog?.(`Building snapshot "${SNAPSHOT_NAME}" (this can take several minutes)...`)
  return daytona.snapshot.create(
    {
      name: SNAPSHOT_NAME,
      image: getAgentSandboxImage(),
      resources: SNAPSHOT_RESOURCES,
    },
    onLog ? { onLogs: onLog } : undefined
  )
}

export interface RotateSnapshotResult {
  /** The newly built snapshot (now the active one). */
  snapshot: Awaited<ReturnType<Daytona["snapshot"]["create"]>>
  /** The name of the snapshot that was deactivated (old one). Undefined on first run. */
  deactivatedName?: string
}

/**
 * Zero-downtime blue/green snapshot rotation.
 *
 * 1. Checks which snapshot currently exists (the "active" one).
 * 2. Builds the *other* snapshot (so the active one stays available).
 * 3. Deletes the old snapshot after the new one is ready.
 *
 * The app uses getActiveSnapshotName() to discover which snapshot to use —
 * no env var or config update needed after rotation.
 */
export async function rotateSnapshot(
  daytona: Daytona,
  options: RebuildSnapshotOptions = {}
): Promise<RotateSnapshotResult> {
  const { onLog } = options

  // Figure out which snapshot currently exists (active) and which to build (target).
  let activeName: string | undefined
  for (const name of ALL_SNAPSHOT_NAMES) {
    try {
      await daytona.snapshot.get(name)
      activeName = name
      break
    } catch {
      // doesn't exist
    }
  }

  // If neither exists (first run), build the primary.
  // If one exists, build the other.
  const targetName = activeName === SNAPSHOT_NAME ? SNAPSHOT_NAME_TEMP : SNAPSHOT_NAME

  onLog?.(`Active snapshot: ${activeName ?? "(none)"}`)
  onLog?.(`Building new snapshot "${targetName}" (this can take several minutes)...`)

  const snapshot = await daytona.snapshot.create(
    {
      name: targetName,
      image: getAgentSandboxImage(),
      resources: SNAPSHOT_RESOURCES,
    },
    onLog ? { onLogs: onLog } : undefined
  )

  // Clean up the old snapshot if one existed.
  if (activeName) {
    try {
      onLog?.(`Deleting old snapshot "${activeName}"...`)
      const old = await daytona.snapshot.get(activeName)
      await daytona.snapshot.delete(old)
    } catch (err) {
      onLog?.(`Warning: failed to delete old snapshot "${activeName}": ${err}`)
    }
  }

  return { snapshot, deactivatedName: activeName }
}
