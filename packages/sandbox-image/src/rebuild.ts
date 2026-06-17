import { Daytona } from "@daytonaio/sdk"
import { getAgentSandboxImage, SNAPSHOT_NAME, SNAPSHOT_RESOURCES } from "./image"

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
