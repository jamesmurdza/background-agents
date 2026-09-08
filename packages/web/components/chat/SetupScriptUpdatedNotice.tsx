"use client"

import { useState } from "react"
import { FileCode, Undo2 } from "lucide-react"
import { useRevertSetupScriptMutation } from "@/lib/query/hooks/useEnvironmentsQuery"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"

interface SetupScriptUpdatedNoticeProps {
  environmentId: string
  environmentName: string
  /** The version now stored, and the one it replaced, for the diff view. */
  current: string
  previous: string | null
  isMobile?: boolean
}

export function SetupScriptUpdatedNotice({
  environmentId,
  environmentName,
  current,
  previous,
  isMobile = false,
}: SetupScriptUpdatedNoticeProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revert = useRevertSetupScriptMutation()

  const revertNow = async () => {
    setError(null)
    try {
      await revert.mutateAsync(environmentId)
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
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs underline underline-offset-2 hover:no-underline cursor-pointer"
          >
            {showDiff ? "Hide diff" : "View diff"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRevert(true)}
            disabled={revert.isPending || previous === null}
            title={previous === null ? "No previous version to revert to" : undefined}
            className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:no-underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
          >
            <Undo2 className="w-3 h-3" /> {revert.isPending ? "Reverting…" : "Revert"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {showDiff && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
          <div>
            <p className="text-muted-foreground mb-1">Before</p>
            <pre className="p-2 rounded bg-background overflow-auto max-h-48 whitespace-pre-wrap">
              {previous ?? "(empty)"}
            </pre>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">After</p>
            <pre className="p-2 rounded bg-background overflow-auto max-h-48 whitespace-pre-wrap">
              {current}
            </pre>
          </div>
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
