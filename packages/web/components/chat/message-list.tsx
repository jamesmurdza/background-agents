"use client"

import { cn } from "@/lib/shared/utils"
import type { Agent, Branch, Message, PushErrorInfo } from "@/lib/shared/types"
import { agentLabels } from "@/lib/shared/types"
import { ASSISTANT_SOURCE, BRANCH_STATUS } from "@/lib/shared/constants"
import { Loader2, AlertCircle } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { forwardRef } from "react"
import { MessageBubble } from "./message-bubble"

// ============================================================================
// Message List Component
// ============================================================================

interface MessageListProps {
  branch: Branch
  repoPath?: string // Repository path for file previews in tool calls
  messagesLoading?: boolean
  isMobile?: boolean
  onScroll?: () => void
  onCommitClick?: (hash: string, msg: string) => void
  onBranchFromCommit?: (hash: string) => void
  onRetryPush?: (pushError: PushErrorInfo) => Promise<{ success: boolean; error?: string }>
  onClearPushError?: (messageId: string) => void
  onRetryExecute?: (messageId: string) => Promise<{ success: boolean; error?: string }>
  onClearExecuteError?: (messageId: string) => void
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  function MessageList(
    { branch, repoPath, messagesLoading, isMobile, onScroll, onCommitClick, onBranchFromCommit, onRetryPush, onClearPushError, onRetryExecute, onClearExecuteError },
    ref
  ) {
    // Creating state
    if (branch.status === BRANCH_STATUS.CREATING) {
      return (
        <MessageListContainer ref={ref} onScroll={onScroll} isMobile={isMobile}>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Setting up sandbox...</p>
            <p className="text-xs text-muted-foreground/60">Cloning repo, installing agent SDK...</p>
          </div>
        </MessageListContainer>
      )
    }

    // Error state without sandbox
    if (branch.status === BRANCH_STATUS.ERROR && !branch.sandboxId) {
      return (
        <MessageListContainer ref={ref} onScroll={onScroll} isMobile={isMobile}>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">Failed to create sandbox</p>
            <p className="text-xs text-muted-foreground/60">Check your API keys in Settings and try again</p>
          </div>
        </MessageListContainer>
      )
    }

    // Loading messages
    if (messagesLoading) {
      return (
        <MessageListContainer ref={ref} onScroll={onScroll} isMobile={isMobile}>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading messages...</p>
          </div>
        </MessageListContainer>
      )
    }

    // Get agent label for display
    const rawAgent = branch.agent as string | undefined
    const normalizedAgent = (!rawAgent || rawAgent === "claude") ? "claude-code" : rawAgent
    const currentAgentLabel = agentLabels[normalizedAgent as Agent] || "Claude Code"

    // Empty state — but not while the agent is already running (optimistic RUNNING can
    // land before the first message is in state; we must still show the working spinner).
    if (branch.messages.length === 0 && branch.status !== BRANCH_STATUS.RUNNING) {
      return (
        <MessageListContainer ref={ref} onScroll={onScroll} isMobile={isMobile}>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
              <AgentIcon agent={normalizedAgent as Agent} className="h-5 w-5" />
            </div>
            <p className="text-sm">Start a conversation with {currentAgentLabel}</p>
            <p className="text-xs text-muted-foreground/60">The agent has access to Read, Edit, Write, Bash and more</p>
          </div>
        </MessageListContainer>
      )
    }

    // Messages list
    return (
      <MessageListContainer ref={ref} onScroll={onScroll} isMobile={isMobile}>
        <div className="flex flex-col gap-5 min-w-0 w-full max-w-full">
          {branch.messages
            .filter((msg) => {
              // Inline git commit chips (always show; empty content is expected)
              if (msg.commitHash) return true
              if (msg.role !== "assistant" || msg.assistantSource !== ASSISTANT_SOURCE.SYSTEM) {
                return true
              }
              const empty = !msg.content?.trim() && !msg.pushError && !msg.executeError
              return !empty
            })
            .map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              agent={normalizedAgent as Agent}
              sandboxId={branch.sandboxId}
              repoPath={repoPath}
              onCommitClick={onCommitClick}
              onBranchFromCommit={onBranchFromCommit}
              onRetryPush={onRetryPush}
              onClearPushError={onClearPushError}
              onRetryExecute={onRetryExecute}
              onClearExecuteError={onClearExecuteError}
            />
          ))}
          {branch.status === BRANCH_STATUS.RUNNING && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Agent is working...
            </div>
          )}
        </div>
      </MessageListContainer>
    )
  }
)

// ============================================================================
// Container Component
// ============================================================================

interface MessageListContainerProps {
  children: React.ReactNode
  isMobile?: boolean
  onScroll?: () => void
}

const MessageListContainer = forwardRef<HTMLDivElement, MessageListContainerProps>(
  function MessageListContainer({ children, isMobile, onScroll }, ref) {
    return (
      <div
        ref={ref}
        onScroll={onScroll}
        className={cn(
          "flex-1 overflow-y-auto overscroll-contain",
          isMobile
            ? "px-3 py-4 pb-4 touch-pan-y h-0 overflow-x-hidden w-full max-w-full"
            : "min-h-0 px-3 py-6 sm:px-6"
        )}
      >
        {children}
      </div>
    )
  }
)
