"use client"

import { cn } from "@/lib/utils"
import type { Branch, ProviderName } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"
import { Send } from "lucide-react"
import { forwardRef, useEffect, useCallback } from "react"
import { AgentSelector } from "./agent-selector"

// ============================================================================
// Chat Input Component
// ============================================================================

interface ChatInputProps {
  branch: Branch
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onAgentChange: (agent: ProviderName) => void
  onModelChange: (model: string) => void
  credentials: {
    hasAnthropicApiKey?: boolean
    hasAnthropicAuthToken?: boolean
    hasOpenaiApiKey?: boolean
  }
  isMobile?: boolean
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { branch, input, onInputChange, onSend, onStop, onAgentChange, onModelChange, credentials, isMobile },
    ref
  ) {
    const canSend = input.trim() && branch.status !== BRANCH_STATUS.RUNNING && branch.status !== BRANCH_STATUS.CREATING && branch.sandboxId
    const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)

    // Auto-resize textarea
    useEffect(() => {
      const textarea = (ref as React.RefObject<HTMLTextAreaElement>)?.current
      if (textarea) {
        textarea.style.height = "auto"
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px"
      }
    }, [input, ref])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSend()
      }
    }, [onSend])

    return (
      <div
        className={cn(
          "shrink-0 border-t border-border",
          isMobile ? "px-3 pt-3" : "px-3 py-3 sm:px-6"
        )}
        style={isMobile ? { paddingBottom: 'calc(var(--safe-area-inset-bottom) + 0.75rem)' } : undefined}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
          <textarea
            ref={ref}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              branch.status === BRANCH_STATUS.CREATING
                ? "Type your first message while the sandbox is being set up..."
                : !branch.sandboxId
                ? "Sandbox not available"
                : branch.status === BRANCH_STATUS.STOPPED
                ? "Sandbox paused \u2014 will resume on send..."
                : "Describe what you want the agent to do..."
            }
            rows={1}
            disabled={!isReady && branch.status !== BRANCH_STATUS.CREATING}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={branch.status === BRANCH_STATUS.RUNNING ? onStop : onSend}
            disabled={branch.status === BRANCH_STATUS.RUNNING ? false : !canSend}
            className={cn(
              "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
              branch.status === BRANCH_STATUS.RUNNING
                ? "bg-red-500/80 text-white hover:bg-red-500"
                : canSend
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {branch.status === BRANCH_STATUS.RUNNING ? (
              <span className="block h-3 w-3 rounded-sm bg-current" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="mt-1.5 flex items-center">
          <AgentSelector
            selectedAgent={branch.agent}
            selectedModel={branch.model}
            onAgentChange={onAgentChange}
            onModelChange={onModelChange}
            disabled={branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING}
            credentials={credentials}
          />
        </div>
      </div>
    )
  }
)
