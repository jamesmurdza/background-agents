"use client"

import { useState, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Clock, AlarmClock, ChevronDown, Check, GitPullRequest } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { cn } from "@/lib/utils"
import { MessageBubble } from "@/components/MessageBubble"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { ScheduledJobActionsMenu } from "@/components/scheduled-jobs/ScheduledJobActionsMenu"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { queryKeys } from "@/lib/query/keys"
import { type ScheduledJob, type ScheduledJobRun } from "@/lib/scheduled-jobs/types"
import type { Message } from "@/lib/types"
import { getRunStatusIcon, formatRunLabel } from "./helpers"
import { formatDurationRange } from "@/lib/format"

interface JobRunDetailProps {
  job: ScheduledJob
  runs: ScheduledJobRun[]
  selectedRun: ScheduledJobRun | null
  onSelectRun: (run: ScheduledJobRun) => void
  messages: Message[]
  onRunNow: (job: ScheduledJob) => void
  onRotateToken: (job: ScheduledJob) => void
  onToggleEnabled: (job: ScheduledJob, enabled: boolean) => void
  onRename: (job: ScheduledJob, name: string) => void
  /** Deletes the job; resolves to whether it succeeded. The caller handles
   *  navigating away from /jobs/[id] once it has. */
  onDelete: (job: ScheduledJob) => Promise<boolean>
}

export function JobRunDetail({
  job,
  runs,
  selectedRun,
  onSelectRun,
  messages,
  onRunNow,
  onRotateToken,
  onToggleEnabled,
  onRename,
  onDelete,
}: JobRunDetailProps) {
  const queryClient = useQueryClient()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Title editing state — same inline-rename pattern as ChatHeader.
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState("")
  const titleInputRef = useRef<HTMLInputElement>(null)

  const startEditingTitle = () => {
    setEditTitleValue(job.name)
    setIsEditingTitle(true)
    setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }, 0)
  }

  const saveTitle = () => {
    const trimmed = editTitleValue.trim()
    if (trimmed && trimmed !== job.name) {
      onRename(job, trimmed)
    }
    setIsEditingTitle(false)
  }

  const cancelEditingTitle = () => {
    setIsEditingTitle(false)
    setEditTitleValue("")
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Detail Header - styled like chat header */}
      <div className="flex items-center justify-between pt-3 shrink-0" style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Title - editable, same pattern as the chat header */}
          {isEditingTitle ? (
            <Input
              ref={titleInputRef}
              type="text"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle()
                if (e.key === "Escape") cancelEditingTitle()
              }}
              onBlur={saveTitle}
              className="w-56 font-medium"
            />
          ) : (
            <button
              onClick={startEditingTitle}
              className="flex h-7 items-center min-w-0 text-sm font-medium text-foreground px-2 rounded-md hover:bg-accent transition-colors cursor-pointer"
              title="Click to rename"
            >
              <span className="truncate">{job.name}</span>
            </button>
          )}

          {/* Run selector dropdown — directly to the right of the title */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              {selectedRun ? (
                <>
                  {getRunStatusIcon(selectedRun.status)}
                  <span className="text-sm">{formatRunLabel(selectedRun)}</span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">No runs yet</span>
              )}
              <ChevronDown className={cn("h-4 w-4 transition-transform", dropdownOpen && "rotate-180")} />
            </button>

            {dropdownOpen && runs.length > 0 && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute left-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      onClick={() => {
                        onSelectRun(run)
                        setDropdownOpen(false)
                      }}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left",
                        run.id === selectedRun?.id && "bg-accent"
                      )}
                    >
                      {getRunStatusIcon(run.status)}
                      <span className="flex-1">{formatRunLabel(run)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Overflow actions menu */}
          <ScheduledJobActionsMenu
            job={job}
            onEdit={() => setEditOpen(true)}
            onRunNow={onRunNow}
            onToggleEnabled={onToggleEnabled}
            onRotateToken={onRotateToken}
            onRequestDelete={() => setDeleteConfirmOpen(true)}
          />
        </div>
      </div>

      {/* Edit form */}
      <ScheduledJobForm
        open={editOpen}
        job={job}
        onClose={() => setEditOpen(false)}
        onSuccess={(updated) => {
          setEditOpen(false)
          queryClient.setQueryData<ScheduledJob>(queryKeys.scheduledJobs.detail(updated.id), updated)
          queryClient.setQueryData<ScheduledJob[]>(queryKeys.scheduledJobs.list(), (old = []) =>
            old.map((j) => (j.id === updated.id ? updated : j))
          )
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete scheduled job?"
        description={`This will permanently delete "${job.name}" and all its run history.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          void onDelete(job)
        }}
        onClose={() => setDeleteConfirmOpen(false)}
      />

      {/* Detail Content */}
      <main className="flex-1 overflow-auto">
        {selectedRun ? (
          <div className="max-w-4xl mx-auto p-6">
            {/* Error display */}
            {selectedRun.error && (
              <div className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <div className="font-medium mb-1">Run failed</div>
                <div className="whitespace-pre-wrap">{selectedRun.error}</div>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {selectedRun.status === "running" ? (
                    <div className="flex items-center justify-center gap-2">
                      <Clock className="h-4 w-4 animate-pulse" />
                      Agent is running...
                    </div>
                  ) : (
                    "No messages for this run"
                  )}
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={message.id || index}
                      message={message}
                      isStreaming={selectedRun.status === "running" && index === messages.length - 1}
                    />
                  ))}

                  {/* Completion summary - styled like system messages */}
                  {selectedRun.status === "completed" && selectedRun.completedAt && (
                    <div className="flex items-start gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                      <span className="text-muted-foreground">
                        Agent finished after {formatDurationRange(selectedRun.startedAt, selectedRun.completedAt)}.
                      </span>
                    </div>
                  )}

                  {/* PR created message */}
                  {selectedRun.status === "completed" && selectedRun.prUrl && (
                    <div className="flex items-start gap-2 text-sm">
                      <GitPullRequest className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                      <a
                        href={selectedRun.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Created PR #{selectedRun.prNumber}.
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlarmClock className="h-6 w-6 text-muted-foreground/50 mb-3" />
            <h2 className="text-sm font-medium mb-1">No runs yet</h2>
            <p className="text-sm text-muted-foreground">
              {job.triggerType === "incoming"
                ? "Waiting for a webhook request to trigger this job."
                : `This job will run ${formatDistanceToNow(job.nextRunAt, { addSuffix: true })}`}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
