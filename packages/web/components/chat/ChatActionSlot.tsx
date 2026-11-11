"use client"

import { ArrowUp, Square, ListPlus, GitBranch, Play } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatActionSlotProps {
  canStop?: boolean
  isRunning: boolean
  /** True when the agent stopped with messages still waiting in the queue. */
  isPaused?: boolean
  /** Whether the composer textarea is currently empty. */
  isInputEmpty?: boolean
  canQueue: boolean
  canSend: boolean
  isMobile: boolean
  showBranchAffordance: boolean
  onSend: (e?: React.MouseEvent) => void
  onStop: () => void
}

/**
 * Keeps the far-right composer action in a stable, fixed-size slot.
 *
 * The wrapper intentionally remains mounted while idle. Otherwise, when a run
 * finishes, the adjacent microphone control shifts into the Stop button's old
 * hit target and can receive a click that was intended to stop the agent.
 */
export function ChatActionSlot({
  canStop = true,
  isRunning,
  isPaused = false,
  isInputEmpty = false,
  canQueue,
  canSend,
  isMobile,
  showBranchAffordance,
  onSend,
  onStop,
}: ChatActionSlotProps) {
  return (
    <div
      data-testid="chat-action-slot"
      className={cn(
        "shrink-0 flex items-center justify-center",
        isMobile ? "h-9 w-9" : "h-7 w-7"
      )}
    >
      {isRunning && canQueue ? (
        <button
          type="button"
          onClick={onSend}
          title="Queue message (sent after current response)"
          aria-label="Queue message"
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          {/* ListPlus (not ArrowUp) so a queued send reads differently from an
              immediate one at a glance, not just via the tooltip. */}
          <ListPlus className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        </button>
      ) : isRunning ? (
        <button
          type="button"
          onClick={onStop}
          disabled={!canStop}
          title={canStop ? "Stop agent" : "Agent is starting"}
          aria-label="Stop agent"
          className={cn(
            "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-wait",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <Square className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")} />
        </button>
      ) : canSend && isPaused && isInputEmpty ? (
        <button
          type="button"
          onClick={onSend}
          title="Resume queued prompts"
          aria-label="Resume queued prompts"
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <Play className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5", "fill-current")} />
        </button>
      ) : canSend ? (
        <button
          type="button"
          onClick={onSend}
          title={showBranchAffordance ? "Send to a new branch" : undefined}
          aria-label={showBranchAffordance ? "Send to a new branch" : "Send message"}
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          {showBranchAffordance ? (
            <GitBranch className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          ) : (
            <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          )}
        </button>
      ) : null}
    </div>
  )
}
