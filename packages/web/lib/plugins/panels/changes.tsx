"use client"

import { useMemo, useState } from "react"
import { ChevronRight, GitCompare, Plus } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import type { ChangedFile, ChangesResult } from "@/lib/git/changes"
import { describeLines, formatLineComment, numberDiffLines, type DiffLine } from "@/lib/git/diff-lines"
import { PanelState } from "./PanelState"
import { CommentBox, addToChatDraft } from "./CommentBox"
import { useSandboxResource, assertSandboxOk } from "@/lib/hooks/useSandboxResource"
import { cn } from "@/lib/utils"

// Files with longer diffs start collapsed, so a lockfile doesn't bury the rest.
const COLLAPSE_LINES = 300

// Tagged with its sandbox, since the panel is reused when switching chats.
type LoadedChanges = ChangesResult & { sandboxId: string }

/** Lines with an open comment box: indexes into one file's patch lines, from the clicked line to the Shift+clicked one. */
interface LineSelection {
  sandboxId: string
  path: string
  anchor: number
  head: number
  /** The lines as they were when clicked, so a reload while the agent works doesn't change what's quoted. */
  lines: DiffLine[]
}

async function loadChanges(args: {
  sandboxId: string
  autoStart: boolean
  signal: AbortSignal
}): Promise<LoadedChanges> {
  const { sandboxId, autoStart, signal } = args
  const res = await fetch("/api/sandbox/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sandboxId, action: "list-changes", autoStart }),
    signal,
  })
  await assertSandboxOk(res)
  return { ...(await res.json()), sandboxId }
}

function DiffLines({
  file,
  selection,
  onSelect,
  onComment,
  onCancel,
}: {
  file: ChangedFile
  /** This file's commented lines, if any. */
  selection: LineSelection | null
  /** Missing when there's no chat to comment into. */
  onSelect?: (index: number, extend: boolean, lines: DiffLine[]) => void
  onComment: (comment: string) => void
  onCancel: () => void
}) {
  const lines = useMemo(() => numberDiffLines(file.lines), [file.lines])
  if (lines.length === 0) {
    return (
      <div className="px-3 pb-2 text-xs text-muted-foreground">
        {file.binary ? "Binary file" : "No content changes"}
      </div>
    )
  }

  // The diff reloads while the agent works, so it may now be shorter.
  const start = selection && Math.min(selection.anchor, selection.head, lines.length - 1)
  const end = selection && Math.min(Math.max(selection.anchor, selection.head), lines.length - 1)

  // One flat list, so the comment box keeps its text when it moves to other lines.
  const rows: React.ReactNode[] = []
  lines.forEach((line, i) => {
    const numbered = line.oldLine !== undefined || line.newLine !== undefined
    rows.push(
      <div
        key={i}
        className={cn(
          "group flex",
          line.text.startsWith("+") && "bg-green-500/15",
          line.text.startsWith("-") && "bg-red-500/15",
          line.text.startsWith("@@") && "text-muted-foreground",
          start !== null && end !== null && i >= start && i <= end && "bg-blue-500/15"
        )}
      >
        <span className="w-9 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/60">{line.oldLine}</span>
        <span className="w-9 flex-shrink-0 select-none pr-1 text-right text-muted-foreground/60">{line.newLine}</span>
        <span className="flex w-6 flex-shrink-0 items-center justify-center">
          {numbered && onSelect && (
            <button
              type="button"
              onClick={(e) => onSelect(i, e.shiftKey, lines)}
              className="flex h-4 w-4 items-center justify-center rounded bg-blue-500 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
              aria-label={`Comment on ${describeLines(file.path, [line])}`}
              title="Comment on this line. Shift+click another line to comment on a range."
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </span>
        <span className="whitespace-pre pr-3">{line.text || " "}</span>
      </div>
    )
    if (selection && i === end) {
      rows.push(
        <CommentBox
          key="comment"
          label={describeLines(file.path, selection.lines)}
          target={selection}
          onAdd={onComment}
          onCancel={onCancel}
          className="sticky left-3 my-1.5 font-sans"
        />
      )
    }
  })

  return (
    <div className="overflow-x-auto pb-2 font-mono text-xs leading-5">
      <div className="min-w-fit">{rows}</div>
    </div>
  )
}

function ChangesComponent({ sandboxId, chatId, messages, explicitStart, onRefresh }: PanelProps) {
  // Re-fetch whenever one of the agent's tool calls finishes (output attached),
  // since any of them may have changed files, and after a merge or other git
  // action, which posts a message to the chat.
  const reloadSignal = useMemo(() => {
    let count = 0
    for (const message of messages ?? []) {
      if (message.messageType === "git-operation") count++
      for (const block of message.contentBlocks ?? []) {
        if (block.type === "tool_calls") count += block.toolCalls.filter((tc) => tc.output).length
      }
    }
    return count
  }, [messages])

  const { status, data, error } = useSandboxResource<LoadedChanges>({
    sandboxId,
    explicitStart,
    deps: [reloadSignal],
    load: ({ autoStart, signal }) => loadChanges({ sandboxId: sandboxId!, autoStart, signal }),
  })
  // Files the user opened or closed, flipping their default.
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [lineSelection, setLineSelection] = useState<LineSelection | null>(null)

  if (status === "stopped") return <PanelState status="stopped" onRefresh={onRefresh} />
  if (status === "expired") return <PanelState status="expired" onRefresh={onRefresh} />
  if (status === "error") return <PanelState status="error" message={error ?? undefined} onRefresh={onRefresh} />
  // Keep the last diff on screen while it reloads, so the scroll position and
  // open files stay put. Never show another chat's diff, though.
  const changes = data?.sandboxId === sandboxId ? data : null
  if (!changes) return <PanelState status="loading" />

  const { files, baseBranch, truncated } = changes
  if (files.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">No changes from {baseBranch} yet.</div>
  }

  const toggle = (path: string) =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const selection = lineSelection?.sandboxId === changes.sandboxId ? lineSelection : null
  const selectLine = (path: string, index: number, extend: boolean, lines: DiffLine[]) => {
    const anchor = extend && selection?.path === path ? selection.anchor : index
    const from = Math.min(anchor, index)
    const to = Math.max(anchor, index)
    setLineSelection({ sandboxId: changes.sandboxId, path, anchor, head: index, lines: lines.slice(from, to + 1) })
  }
  const addComment = (comment: string) => {
    if (!chatId || !selection) return
    addToChatDraft(chatId, formatLineComment(selection.path, selection.lines, comment))
    setLineSelection(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="flex-1 truncate">
          {files.length} {files.length === 1 ? "file" : "files"} changed from {baseBranch}
        </span>
        <span className="text-green-600 dark:text-green-400">+{files.reduce((n, f) => n + f.additions, 0)}</span>
        <span className="text-red-600 dark:text-red-400">−{files.reduce((n, f) => n + f.deletions, 0)}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {files.map((file) => {
          const open = (file.lines.length <= COLLAPSE_LINES) !== toggled.has(file.path)
          return (
            <div key={file.path} className="border-b">
              <button
                type="button"
                onClick={() => toggle(file.path)}
                className="sticky top-0 z-10 flex w-full items-center gap-2 bg-background px-3 py-1.5 text-left text-sm hover:bg-accent cursor-pointer"
              >
                <ChevronRight
                  className={cn("h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                />
                <span className="flex-1 truncate font-mono text-xs">{file.path}</span>
                {file.status !== "modified" && (
                  <span className="flex-shrink-0 text-xs text-muted-foreground">{file.status}</span>
                )}
                {file.uncommitted && (
                  <span className="flex-shrink-0 rounded bg-amber-500/10 px-1.5 text-xs text-amber-600 dark:text-amber-400">
                    Uncommitted
                  </span>
                )}
                <span className="flex-shrink-0 text-xs text-green-600 dark:text-green-400">+{file.additions}</span>
                <span className="flex-shrink-0 text-xs text-red-600 dark:text-red-400">−{file.deletions}</span>
              </button>
              {open && (
                <DiffLines
                  file={file}
                  selection={selection?.path === file.path ? selection : null}
                  onSelect={chatId ? (index, extend, lines) => selectLine(file.path, index, extend, lines) : undefined}
                  onComment={addComment}
                  onCancel={() => setLineSelection(null)}
                />
              )}
            </div>
          )
        })}
        {truncated && (
          <div className="p-3 text-center text-xs text-muted-foreground">The rest of the diff is too large to show.</div>
        )}
      </div>
    </div>
  )
}

export const ChangesPlugin: PanelPlugin = {
  id: "changes",

  canHandle: (item: PreviewItem) => item.type === "changes",

  getLabel: () => "Changes",

  getIcon: () => GitCompare,

  Component: ChangesComponent,
}
