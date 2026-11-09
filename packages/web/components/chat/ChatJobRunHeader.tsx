"use client"

import { useState, useRef } from "react"
import { Check, ChevronDown } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useScheduledJobRunsQuery } from "@/lib/query/hooks/useScheduledJobRunsQuery"
import type { ChatScheduledJobRun } from "@/lib/scheduled-jobs/types"

/** "Nov 9, 3:00pm" — month capitalized, am/pm lowercase. Matches
 *  getChatDisplayTitle's formatting in lib/chat-tree.ts so run dates look
 *  consistent wherever they're shown. Used for the trigger button, which
 *  stays compact since it sits inline with the title. */
function formatRunDate(startedAt: number): string {
  return format(startedAt, "MMM d, h:mma").replace(/AM|PM/, (m) => m.toLowerCase())
}

/** "November 9, 3:00pm" — same as formatRunDate but with the full month
 *  name, used inside the dropdown list where there's room for it. */
function formatRunDateLong(startedAt: number): string {
  return format(startedAt, "MMMM d, h:mma").replace(/AM|PM/, (m) => m.toLowerCase())
}

interface ChatJobRunHeaderProps {
  /** The run linked to the chat currently open — see Chat.scheduledJobRun. */
  run: ChatScheduledJobRun
  /** Current chat id, to highlight it in the "previous runs" dropdown. */
  currentChatId: string
  /** Opens a chat by id — same mechanism used by the sidebar/Triggers modal. */
  onSelectChat: (chatId: string) => void
}

/**
 * Run-date menu for chats linked to a ScheduledJobRun — a second, separate
 * menu from the job title next to it, for jumping between a job's previous
 * runs. Job management (run now / enable-disable / rotate token / delete)
 * intentionally doesn't live here anymore — that's the Triggers modal's
 * job; this chat view only keeps an Edit entry point, rendered by ChatHeader
 * in the right-side toolbar.
 */
export function ChatJobRunHeader({ run, currentChatId, onSelectChat }: ChatJobRunHeaderProps) {
  const [runsOpen, setRunsOpen] = useState(false)
  const runsMenuRef = useRef<HTMLDivElement>(null)
  useClickOutside(runsMenuRef, () => setRunsOpen(false), runsOpen)

  const { data: runs = [] } = useScheduledJobRunsQuery(run.jobId, runsOpen)

  return (
    <div className="relative shrink-0" ref={runsMenuRef}>
      <button
        onClick={() => setRunsOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
        title="Previous runs"
      >
        <span className="truncate">{formatRunDate(run.startedAt)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {runsOpen && (
        <div className="absolute left-0 top-full mt-1 min-w-[260px] max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 z-50">
          {runs.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
          ) : (
            runs.map((r) => (
              <button
                key={r.id}
                disabled={!r.chatId}
                onClick={() => {
                  if (r.chatId) onSelectChat(r.chatId)
                  setRunsOpen(false)
                }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors",
                  r.chatId ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-default",
                  r.chatId === currentChatId && "bg-accent/60"
                )}
              >
                <span className="flex-1 truncate">{formatRunDateLong(r.startedAt)}</span>
                {r.chatId === currentChatId && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
