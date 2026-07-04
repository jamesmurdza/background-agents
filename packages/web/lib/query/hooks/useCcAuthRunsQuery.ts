"use client"

import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { adminRetry, fetchAdminJson } from "./adminQuery"

/** One row of the Claude credential-refresh audit log. */
export interface CcAuthRun {
  id: string
  status: "skipped" | "refreshed" | "error" | string
  code: string | null
  message: string | null
  trigger: string
  forced: boolean
  cookiesUpdated: boolean
  durationMs: number
  expiresAt: string | null
  createdAt: string
}

interface CcAuthRunsResponse {
  runs: CcAuthRun[]
}

export function useCcAuthRunsQuery() {
  const { status } = useSession()

  return useQuery({
    queryKey: queryKeys.admin.ccAuthRuns(),
    queryFn: () =>
      fetchAdminJson<CcAuthRunsResponse>(
        "/api/admin/refresh-claude-creds",
        "ccauth runs",
      ),
    enabled: status === "authenticated",
    staleTime: 15 * 1000,
    retry: adminRetry,
  })
}
