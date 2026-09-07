"use client"

import { useState } from "react"
import { EnvironmentsList } from "./EnvironmentsList"
import { EnvironmentEditor } from "./EnvironmentEditor"
import { nextEnvironmentName } from "./helpers"
import {
  useEnvironmentsQuery,
  useCreateEnvironmentMutation,
} from "@/lib/query/hooks/useEnvironmentsQuery"

interface EnvironmentsViewProps {
  /** Environment id from the URL. Null shows the list. */
  urlEnvironmentId: string | null
  onNavigate: (id: string | null) => void
}

export function EnvironmentsView({ urlEnvironmentId, onNavigate }: EnvironmentsViewProps) {
  // includeVariables: true because this view is also where EnvironmentEditor
  // reads and writes variables (selected below). EnvironmentsList only shows
  // names and counts from the same result, so it does not need its own query.
  const { data: environments = [], isLoading, error } = useEnvironmentsQuery(undefined, true)
  const selected = environments.find((e) => e.id === urlEnvironmentId) ?? null

  const create = useCreateEnvironmentMutation()
  const [creatingRepo, setCreatingRepo] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreate = async (repo: string) => {
    setCreateError(null)
    setCreatingRepo(repo)
    try {
      // A plain, renamable default: the editor's name field is the place to
      // actually name it, so this picks the first "New environment N" not
      // already taken by a sibling in the repo, avoiding a collision with
      // the API's per-repo name uniqueness check.
      const siblingNames = environments.filter((e) => e.repo === repo).map((e) => e.name)
      const created = await create.mutateAsync({
        repo,
        name: nextEnvironmentName(siblingNames),
      })
      onNavigate(created.id)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create environment")
    } finally {
      setCreatingRepo(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {!urlEnvironmentId && (
        <div
          className="flex items-center justify-between pt-3 shrink-0"
          style={{ paddingLeft: "1.625rem", paddingRight: "1.625rem" }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 items-center text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-default">
              Environments
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading environments...</div>
        ) : error ? (
          <div role="alert" className="m-4 px-3 py-2 text-sm rounded-md bg-destructive/10 text-destructive">
            {error instanceof Error ? error.message : "Failed to load environments"}
          </div>
        ) : urlEnvironmentId && !selected ? (
          <div className="p-6 space-y-2">
            <p className="text-sm text-muted-foreground">Environment not found.</p>
            <button
              onClick={() => onNavigate(null)}
              className="text-sm text-primary hover:underline cursor-pointer"
            >
              Back to environments
            </button>
          </div>
        ) : selected ? (
          // Keyed by id so switching environments mounts a fresh
          // EnvironmentEditor instance (fresh useState) instead of reusing one
          // whose local edit state would need reconciling against new props:
          // that reconciliation effect was also what let a mutation's
          // query-invalidation refetch silently overwrite unsaved typing.
          <EnvironmentEditor
            key={selected.id}
            environment={selected}
            onBack={() => onNavigate(null)}
            onDeleted={() => onNavigate(null)}
            onDuplicated={(id) => onNavigate(id)}
          />
        ) : (
          <div className="flex flex-col min-h-0 h-full">
            {createError && (
              <div
                role="alert"
                className="mx-4 mt-3 px-3 py-2 text-sm rounded-md bg-destructive/10 text-destructive shrink-0"
              >
                {createError}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-auto">
              <EnvironmentsList
                environments={environments}
                onSelect={(id) => onNavigate(id)}
                onCreate={handleCreate}
                creatingRepo={creatingRepo}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
