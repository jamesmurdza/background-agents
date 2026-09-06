"use client"

import { EnvironmentsList } from "./EnvironmentsList"
import { EnvironmentEditor } from "./EnvironmentEditor"
import { useEnvironmentsQuery } from "@/lib/query/hooks/useEnvironmentsQuery"

interface EnvironmentsViewProps {
  /** Environment id from the URL. Null shows the list. */
  urlEnvironmentId: string | null
  onNavigate: (id: string | null) => void
}

export function EnvironmentsView({ urlEnvironmentId, onNavigate }: EnvironmentsViewProps) {
  const { data: environments = [], isLoading, error } = useEnvironmentsQuery()
  const selected = environments.find((e) => e.id === urlEnvironmentId) ?? null

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
          <EnvironmentsList environments={environments} onSelect={(id) => onNavigate(id)} />
        )}
      </div>
    </div>
  )
}
