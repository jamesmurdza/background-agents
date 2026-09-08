"use client"

import { useState } from "react"
import { FileCode, Undo2, X } from "lucide-react"
import { useRevertSetupScriptMutation, fetchEnvironmentScript } from "@/lib/query/hooks/useEnvironmentsQuery"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"

interface SetupScriptUpdatedNoticeProps {
  environmentId: string
  environmentName: string
  /** Records the dismissal (see useSetupScriptNoticeDismissal) and hides the
   *  notice. Also called after a successful revert, which resolves it just
   *  as much as an explicit dismiss would. */
  onDismiss: () => void
  isMobile?: boolean
}

type DiffState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; current: string; previous: string | null }
  | { status: "error"; message: string }

/**
 * "The agent updated the setup script" notice.
 *
 * Deliberately holds no script text until the user asks for it: the before/
 * after bodies are fetched fresh from GET /api/environments/[id] only when
 * "View diff" is opened, not kept eagerly for every chat whose notice never
 * gets a second look. Whether "Revert" is possible at all is likewise not
 * pre-computed: a chat with nothing to revert to just gets the server's
 * "There is no previous version to revert to" back as the error, which is a
 * true statement said once, rather than a guess said in advance.
 */
export function SetupScriptUpdatedNotice({
  environmentId,
  environmentName,
  onDismiss,
  isMobile = false,
}: SetupScriptUpdatedNoticeProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [diff, setDiff] = useState<DiffState>({ status: "idle" })
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revert = useRevertSetupScriptMutation()

  const toggleDiff = async () => {
    if (showDiff) {
      setShowDiff(false)
      return
    }
    setShowDiff(true)
    setDiff({ status: "loading" })
    try {
      const { current, previous } = await fetchEnvironmentScript(environmentId)
      setDiff({ status: "loaded", current, previous })
    } catch (err) {
      setDiff({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load the setup script",
      })
    }
  }

  const revertNow = async () => {
    setError(null)
    try {
      await revert.mutateAsync(environmentId)
      onDismiss()
    } catch (err) {
      // ConfirmDialog closes itself immediately regardless of the async
      // result (see EnvironmentEditor's confirmPromoteNow), so a failure has
      // to surface here rather than vanish with the dialog.
      setError(err instanceof Error ? err.message : "Failed to revert the setup script")
    }
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <FileCode className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          The agent updated the setup script in <strong>{environmentName}</strong>
        </span>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={toggleDiff}
            className="text-xs underline underline-offset-2 hover:no-underline cursor-pointer"
          >
            {showDiff ? "Hide diff" : "View diff"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRevert(true)}
            disabled={revert.isPending}
            className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:no-underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
          >
            <Undo2 className="w-3 h-3" /> {revert.isPending ? "Reverting…" : "Revert"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {showDiff && (
        <div className="mt-2 text-xs font-mono">
          {diff.status === "loading" && <p className="text-muted-foreground">Loading…</p>}
          {diff.status === "error" && (
            <p role="alert" className="text-destructive">
              {diff.message}
            </p>
          )}
          {diff.status === "loaded" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <p className="text-muted-foreground mb-1">Before</p>
                <pre className="p-2 rounded bg-background overflow-auto max-h-48 whitespace-pre-wrap">
                  {diff.previous ?? "(empty)"}
                </pre>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">After</p>
                <pre className="p-2 rounded bg-background overflow-auto max-h-48 whitespace-pre-wrap">
                  {diff.current}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRevert}
        onClose={() => setConfirmRevert(false)}
        title="Revert the setup script?"
        description={`This restores the version the agent replaced in ${environmentName}. Every future sandbox built from this environment will use it again.`}
        confirmLabel="Revert"
        onConfirm={revertNow}
        isMobile={isMobile}
      />
    </div>
  )
}
