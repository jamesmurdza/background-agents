"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
// Type-only: EnvironmentDTO's module imports @/lib/db/prisma. A plain value
// import here would pull Prisma into the browser bundle.
import type { EnvironmentDTO } from "@/lib/environments"

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/**
 * All environments for the user, or just one repo's when `repo` is given.
 *
 * `includeVariables` asks the server to decrypt and return each
 * environment's `variables` too (see GET /api/environments). Leave it false
 * (the default) for anything that only displays names/counts, like the
 * combobox and the list view: without it, decrypted secrets for every
 * environment on a repo would sit in the SPA's memory on every render that
 * merely shows a picker. Only the environments editor, which actually reads
 * and writes variables, should pass true.
 *
 * `enabled` (default true) is ANDed with the auth check: pass `false` when a
 * caller only wants this for one specific repo/chat and that repo isn't real
 * yet (a draft or NEW_REPOSITORY chat), so it doesn't fall back to fetching
 * every environment for every repo the user has just because `repo` was
 * left undefined — that fallback is intentional for a caller that really
 * does want everything (the environments list view), not an accidental side
 * effect of "no repo to scope to yet".
 */
export function useEnvironmentsQuery(repo?: string, includeVariables = false, enabled = true) {
  const { status } = useSession()
  return useQuery({
    queryKey: queryKeys.environments.list(repo, includeVariables),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (repo) params.set("repo", repo)
      if (includeVariables) params.set("include", "variables")
      const qs = params.toString()
      const url = qs ? `/api/environments?${qs}` : "/api/environments"
      const data = await json<{ environments: EnvironmentDTO[] }>(await fetch(url))
      return data.environments
    },
    enabled: enabled && status === "authenticated",
    staleTime: 30 * 1000,
  })
}

export interface CreateEnvironmentInput {
  repo: string
  name: string
  duplicateOf?: string
}

export function useCreateEnvironmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEnvironmentInput) => {
      const data = await json<{ environment: EnvironmentDTO }>(
        await fetch("/api/environments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      )
      return data.environment
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.environments.all }),
  })
}

export interface UpdateEnvironmentInput {
  id: string
  name?: string
  networkMode?: "full" | "restricted"
  allowedDomains?: string[]
  variables?: Record<string, string>
  setupScript?: string | null
  isDefault?: true
}

export function useUpdateEnvironmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateEnvironmentInput) => {
      const data = await json<{ environment: EnvironmentDTO }>(
        await fetch(`/api/environments/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        })
      )
      return data.environment
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.environments.all }),
  })
}

export function useDeleteEnvironmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await json<{ success: true }>(await fetch(`/api/environments/${id}`, { method: "DELETE" }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.environments.all }),
  })
}

/** Chat count for the delete confirmation. Fetched on demand, not prefetched. */
export async function fetchEnvironmentUsage(id: string): Promise<number> {
  const data = await json<{ chatCount: number }>(await fetch(`/api/environments/${id}/usage`))
  return data.chatCount
}

/**
 * The current and previous setup-script bodies, fetched fresh on demand
 * (the diff view's "View diff" click) rather than kept in the query cache:
 * the "agent updated the script" notice's visibility never depends on this
 * data (see Chat.scriptUpdateNotice), so there is no reason to hold two
 * script revisions in memory for every chat whose notice never gets opened.
 */
export async function fetchEnvironmentScript(
  id: string
): Promise<{ current: string; previous: string | null }> {
  const data = await json<{ environment: EnvironmentDTO }>(await fetch(`/api/environments/${id}`))
  return { current: data.environment.setupScript ?? "", previous: data.environment.setupScriptPrevious }
}

/** Swaps `setupScriptPrevious` back into `setupScript` (one level of undo for
 *  an agent's edit). */
export function useRevertSetupScriptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const data = await json<{ environment: EnvironmentDTO }>(
        await fetch(`/api/environments/${id}/revert-script`, { method: "POST" })
      )
      return data.environment
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.environments.all }),
  })
}
