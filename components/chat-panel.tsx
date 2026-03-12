"use client"

import { cn } from "@/lib/utils"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS } from "@/lib/constants"
import { type AgentProvider } from "@/lib/agent-providers"
import { Terminal } from "lucide-react"
import { useRef, useEffect, useCallback } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"

// Import hooks
import {
  useDraftSync,
  useAgentStream,
  useGitActions,
  useBranchRenaming,
} from "./chat/hooks"

// Import sub-components
import { ChatHeader } from "./chat/chat-header"
import { MessageList } from "./chat/message-list"
import { ChatInput } from "./chat/chat-input"
import { ChatDialogs } from "./chat/chat-dialogs"

// ============================================================================
// Main ChatPanel Component
// ============================================================================

interface ChatPanelProps {
  branch: Branch
  repoFullName: string
  repoName: string
  repoOwner: string
  gitHistoryOpen: boolean
  onToggleGitHistory: () => void
  onAddMessage: (message: Message) => Promise<string>
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
  onAgentChange?: (agent: AgentProvider) => void
  onModelChange?: (model: string) => void
  credentials?: {
    hasAnthropicApiKey?: boolean
    hasAnthropicAuthToken?: boolean
    hasOpenaiApiKey?: boolean
  }
  messagesLoading?: boolean
  isMobile?: boolean
}

export function ChatPanel({
  branch,
  repoFullName,
  repoName,
  repoOwner,
  gitHistoryOpen,
  onToggleGitHistory,
  onAddMessage,
  onUpdateMessage,
  onUpdateBranch,
  onSaveDraftForBranch,
  onCommitsDetected,
  onBranchFromCommit,
  onAgentChange,
  onModelChange,
  credentials,
  messagesLoading = false,
  isMobile = false,
}: ChatPanelProps) {
  // Refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Custom hooks
  const { input, setInput, isNearBottomRef } = useDraftSync({
    branch,
    onSaveDraftForBranch,
  })

  const {
    currentMessageIdRef,
    startStream,
    stopStream,
  } = useAgentStream({
    branch,
    repoName,
    onUpdateMessage,
    onUpdateBranch,
    onCommitsDetected,
  })

  const gitActions = useGitActions({
    branch,
    repoName,
    repoFullName,
    repoOwner,
    onUpdateBranch,
    onAddMessage,
    onToggleGitHistory,
  })

  const renaming = useBranchRenaming({
    branch,
    repoName,
    repoFullName,
    onUpdateBranch,
    addSystemMessage: gitActions.addSystemMessage,
  })

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150
    }
  }, [isNearBottomRef])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [branch.messages, isNearBottomRef])

  // Send message handler
  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || branch.status === BRANCH_STATUS.RUNNING || branch.status === BRANCH_STATUS.CREATING) return
    if (!branch.sandboxId) return

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    await onAddMessage(userMsg)
    setInput("")

    onUpdateBranch({ status: BRANCH_STATUS.RUNNING, draftPrompt: "" })

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(assistantMsg)
    currentMessageIdRef.current = messageId

    // Start SSE stream
    startStream(messageId, prompt)
  }, [input, branch, onAddMessage, onUpdateBranch, startStream, currentMessageIdRef, setInput])

  // Stop handler
  const handleStop = useCallback(() => {
    stopStream()
  }, [stopStream])

  // Handle commit click
  const handleCommitClick = useCallback((hash: string, msg: string) => {
    gitActions.setCommitDiffHash(hash)
    gitActions.setCommitDiffMessage(msg)
  }, [gitActions])

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn(
        "flex min-w-0 flex-1 flex-col bg-background overflow-hidden",
        isMobile ? "h-full w-full max-w-full" : "min-h-0"
      )}>
        {/* Header - hidden on mobile */}
        {!isMobile && (
          <ChatHeader
            branch={branch}
            repoFullName={repoFullName}
            gitHistoryOpen={gitHistoryOpen}
            gitActions={gitActions}
            renaming={renaming}
          />
        )}

        {/* Messages */}
        <MessageList
          ref={scrollRef}
          branch={branch}
          messagesLoading={messagesLoading}
          isMobile={isMobile}
          onScroll={handleScroll}
          onCommitClick={handleCommitClick}
          onBranchFromCommit={onBranchFromCommit}
        />

        {/* Input */}
        <ChatInput
          ref={textareaRef}
          branch={branch}
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          onStop={handleStop}
          onAgentChange={onAgentChange}
          onModelChange={onModelChange}
          credentials={credentials}
          isMobile={isMobile}
        />
      </div>

      {/* Dialogs */}
      <ChatDialogs
        branch={branch}
        repoOwner={repoOwner}
        repoName={repoName}
        gitActions={gitActions}
      />
    </TooltipProvider>
  )
}

export function EmptyChatPanel({ hasRepos }: { hasRepos?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <Terminal className="h-7 w-7" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {hasRepos ? "Select a branch to start" : "Add a repository to get started"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasRepos
            ? "Choose a repository and branch from the sidebar"
            : "Click the + button in the sidebar to add a GitHub repo"}
        </p>
      </div>
    </div>
  )
}
