import { useEffect, useState } from "react"
import { extractErrorMessage } from "@/lib/fetch-error"
import { classifyResponse, type SandboxState } from "@/lib/sandbox-lifecycle"

/** Outcome of a sandbox-backed fetch, as a panel renders it. */
export type ResourceStatus = "loading" | "ready" | "stopped" | "expired" | "error"

/**
 * Thrown by a `load` callback when the sandbox is stopped/expired. The hook
 * maps it onto the corresponding {@link ResourceStatus}. Use {@link assertSandboxOk}
 * to raise it for you.
 */
export class SandboxStateError extends Error {
  constructor(public readonly state: Exclude<SandboxState, "ready">) {
    super(state)
    this.name = "SandboxStateError"
  }
}

/**
 * Guard for a `/api/sandbox/*` response inside a `load` callback. Throws a
 * {@link SandboxStateError} for the lifecycle codes (409/410) and a plain Error
 * (carrying the body's `error`) for any other non-OK response. Returns on OK so
 * the caller can parse the body.
 */
export async function assertSandboxOk(res: Response): Promise<void> {
  const cls = classifyResponse(res)
  if (cls.kind === "state") throw new SandboxStateError(cls.state)
  if (cls.kind === "error") {
    throw new Error(await extractErrorMessage(res, `Request failed (${res.status})`))
  }
}

export interface SandboxResource<T> {
  status: ResourceStatus
  data: T | null
  /** Error message when status is "error". */
  error: string | null
}

export interface UseSandboxResourceOptions<T> {
  sandboxId: string | null
  /** Extra deps that should re-trigger the load (e.g. filePath, an edit signal). */
  deps?: unknown[]
  /**
   * True when the current mount was triggered by an explicit user refresh, so
   * this load may boot a stopped sandbox. Refresh remounts the panel (see
   * PanelProps.refreshNonce), so a fresh load is the single retry path.
   */
  explicitStart?: boolean
  /**
   * Perform the request. `autoStart` mirrors `explicitStart`. Call
   * {@link assertSandboxOk} on the response, then parse and return the data.
   */
  load: (args: { autoStart: boolean; signal: AbortSignal }) => Promise<T>
}

/**
 * Encapsulates the loading / ready / stopped / expired / error state machine
 * shared by sandbox-backed preview panels, including abort-on-unmount. Panels
 * supply only the request via `load`; retry happens by remount (`refreshNonce`).
 */
export function useSandboxResource<T>({
  sandboxId,
  deps = [],
  explicitStart,
  load,
}: UseSandboxResourceOptions<T>): SandboxResource<T> {
  const [status, setStatus] = useState<ResourceStatus>("loading")
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sandboxId) {
      setStatus("error")
      setError("No sandbox.")
      return
    }

    let cancelled = false
    const controller = new AbortController()
    const autoStart = Boolean(explicitStart)

    setStatus("loading")
    setError(null)

    load({ autoStart, signal: controller.signal })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setStatus("ready")
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return
        if (err instanceof SandboxStateError) {
          setStatus(err.state)
        } else {
          setError(err instanceof Error ? err.message : "Failed to load")
          setStatus("error")
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // `load` is intentionally excluded — it's a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxId, explicitStart, ...deps])

  return { status, data, error }
}
