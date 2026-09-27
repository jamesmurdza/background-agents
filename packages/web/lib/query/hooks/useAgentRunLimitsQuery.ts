"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"

export interface AgentRunLimits {
  /** Minutes an interactive chat's agent may run before the cron stops it. */
  interactiveMinutes: number
  /** Minutes a scheduled job's agent may run before the cron stops it. */
  scheduledMinutes: number
  updatedAt: string | null
  updatedBy: string | null
}

async function fetchAgentRunLimits(): Promise<AgentRunLimits> {
  return fetchAdminJson<AgentRunLimits>("/api/admin/agent-run-limits", "agent run limits")
}

/** The admin-editable max agent run duration, for interactive and scheduled runs. */
export function useAgentRunLimitsQuery() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.admin.agentRunLimits(),
    queryFn: fetchAgentRunLimits,
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    retry: adminRetry,
  })
}

interface SetAgentRunLimitsParams {
  interactiveMinutes: number
  scheduledMinutes: number
}

async function setAgentRunLimits({
  interactiveMinutes,
  scheduledMinutes,
}: SetAgentRunLimitsParams): Promise<SetAgentRunLimitsParams> {
  const response = await fetch("/api/admin/agent-run-limits", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interactiveMinutes, scheduledMinutes }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || "Failed to update agent run limits")
  }

  return response.json()
}

export function useSetAgentRunLimitsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setAgentRunLimits,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.agentRunLimits() })
    },
  })
}
