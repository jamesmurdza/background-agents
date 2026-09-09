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
 */
export function useEnvironmentsQuery(repo?: string, includeVariables = false) {
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
    enabled: status === "authenticated",
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
