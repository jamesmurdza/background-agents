import { parseSSEStream } from "@upstream/common"
import type { Agent } from "@/lib/shared/types"

/**
 * Branch creation utilities - shared between desktop and mobile
 */

export interface CreateBranchParams {
  repoId: string
  repoOwner: string
  repoName: string
  baseBranch: string
  newBranch: string
  startCommit?: string
}

export interface CreateBranchResult {
  branchId: string
  sandboxId: string
  contextId?: string
  previewUrlPattern?: string
  startCommit?: string
  agent?: Agent
}

export interface CreateBranchCallbacks {
  onDone: (result: CreateBranchResult) => void
  onError: (message: string) => void
}

/**
 * Create a new branch with sandbox via SSE stream.
 * Handles the API call and SSE parsing, calling callbacks for done/error events.
 * Returns true if creation completed successfully, false otherwise.
 */
export async function createBranchWithSandbox(
  params: CreateBranchParams,
  callbacks: CreateBranchCallbacks
): Promise<boolean> {
  const res = await fetch("/api/sandbox/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoId: params.repoId,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      baseBranch: params.baseBranch,
      newBranch: params.newBranch,
      ...(params.startCommit ? { startCommit: params.startCommit } : {}),
    }),
  })

  if (!res.ok) {
    let message = `Failed to create branch (${res.status})`
    try {
      const data = await res.json()
      message = data.error || data.message || message
    } catch {
      // Ignore parse errors
    }
    throw new Error(message)
  }

  if (!res.body) {
    throw new Error("Failed to create branch: empty server response")
  }

  let hasTerminalEvent = false

  await parseSSEStream(res, (event) => {
    if (event.type === "done") {
      hasTerminalEvent = true
      callbacks.onDone({
        branchId: event.branchId as string,
        sandboxId: event.sandboxId as string,
        contextId: event.contextId as string | undefined,
        previewUrlPattern: event.previewUrlPattern as string | undefined,
        startCommit: event.startCommit as string | undefined,
        agent: event.agent as Agent | undefined,
      })
    } else if (event.type === "error") {
      hasTerminalEvent = true
      callbacks.onError((event.message as string) || "Unknown error")
    }
  })

  if (!hasTerminalEvent) {
    throw new Error("Branch creation did not complete. Please try again.")
  }

  return true
}
