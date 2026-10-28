"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "../keys"
import { extractErrorMessage } from "@/lib/fetch-error"

export interface RefreshClaudeCredsParams {
  /** Bypass the skip-while-fresh threshold and regenerate the token now. */
  force?: boolean
  /** Optional new claude.ai cookies JSON to store before refreshing. */
  cookies?: string
}

export interface RefreshClaudeCredsResult {
  skipped?: boolean
  refreshed?: boolean
  expiresAt?: number
}

async function refreshClaudeCreds(
  params: RefreshClaudeCredsParams,
): Promise<RefreshClaudeCredsResult> {
  const response = await fetch("/api/admin/refresh-claude-creds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      force: params.force ?? false,
      cookies: params.cookies || undefined,
    }),
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Failed to refresh Claude credentials"))
  }
  return response.json()
}

export function useRefreshClaudeCredsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: refreshClaudeCreds,
    // Every refresh appends an audit-log row — refresh the log view regardless
    // of success/failure (failed runs are logged too).
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.ccAuthRuns(),
      })
    },
  })
}
