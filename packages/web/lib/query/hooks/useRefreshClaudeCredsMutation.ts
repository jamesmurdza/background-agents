"use client"

import { useMutation } from "@tanstack/react-query"

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

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      data.message || data.error || "Failed to refresh Claude credentials",
    )
  }
  return data
}

export function useRefreshClaudeCredsMutation() {
  return useMutation({ mutationFn: refreshClaudeCreds })
}
