"use client"

import { cn } from "@/lib/utils"
import type { Agent, Branch, Message } from "@/lib/types"
import { defaultAgentModel } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS } from "@/lib/constants"
import { Terminal } from "lucide-react"
import { useRef, useEffect, useCallback, useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SwitchAgentDialog } from "@/components/switch-agent-dialog"

// Import hooks
import {
  useDraftSync,
  useExecutionPolling,
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
  onForceSave: () => void
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
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
  onForceSave,
  onCommitsDetected,
  onBranchFromCommit,
  messagesLoading = false,
  isMobile = false,
}: ChatPanelProps) {
  // Refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // State for agent switch dialog
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<Agent | null>(null)

  // Custom hooks
  const { input, setInput, isNearBottomRef } = useDraftSync({
    branch,
    onSaveDraftForBranch,
  })

  const {
    currentExecutionIdRef,
    currentMessageIdRef,
    startPolling,
    stopPolling,
  } = useExecutionPolling({
    branch,
    repoName,
    onUpdateMessage,
    onUpdateBranch,
    onAddMessage,
    onForceSave,
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

    try {
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          prompt,
          previewUrlPattern: branch.previewUrlPattern,
          repoName,
          messageId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to start agent")
      }

      const { executionId } = await response.json()
      currentExecutionIdRef.current = executionId
      startPolling(messageId, executionId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(messageId, { content: `Error: ${message}` })
      onUpdateBranch({ status: BRANCH_STATUS.IDLE })
      currentMessageIdRef.current = null
      currentExecutionIdRef.current = null
    }
  }, [input, branch, repoName, onAddMessage, onUpdateMessage, onUpdateBranch, startPolling, currentMessageIdRef, currentExecutionIdRef, setInput])

  // Stop handler
  const handleStop = useCallback(() => {
    stopPolling()
    abortControllerRef.current?.abort()
  }, [stopPolling])

  // Handle commit click
  const handleCommitClick = useCallback((hash: string, msg: string) => {
    gitActions.setCommitDiffHash(hash)
    gitActions.setCommitDiffMessage(msg)
  }, [gitActions])

  // Handle agent change request
  const handleAgentChange = useCallback(async (agent: Agent) => {
    // If switching to the same agent, do nothing
    const currentAgent = (branch.agent || "claude-code") as Agent
    if (agent === currentAgent) return

    // If there are messages, show confirmation dialog
    if (branch.messages.length > 0) {
      setPendingAgentSwitch(agent)
      return
    }

    // No messages, switch immediately
    await performAgentSwitch(agent)
  }, [branch.agent, branch.messages.length, performAgentSwitch])

  // Perform the actual agent switch
  const performAgentSwitch = useCallback(async (agent: Agent) => {
    // Update local state immediately
    onUpdateBranch({ agent, model: defaultAgentModel[agent] })

    // Persist to server and clear session ID to start fresh
    try {
      await fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branch.id,
          agent,
          model: defaultAgentModel[agent],
          clearSession: true, // Signal to clear the session ID
        }),
      })
    } catch (err) {
      console.error("Failed to update agent:", err)
    }
  }, [branch.id, onUpdateBranch])

  // Handle agent switch confirmation
  const handleAgentSwitchConfirm = useCallback(async (agent: Agent) => {
    await performAgentSwitch(agent)
    setPendingAgentSwitch(null)
  }, [performAgentSwitch])

  // Handle agent switch cancellation
  const handleAgentSwitchCancel = useCallback(() => {
    setPendingAgentSwitch(null)
  }, [])

  // Handle model change
  const handleModelChange = useCallback(async (model: string) => {
    // Update local state immediately
    onUpdateBranch({ model })

    // Persist to server
    try {
      await fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branch.id,
          model,
        }),
      })
    } catch (err) {
      console.error("Failed to update model:", err)
    }
  }, [branch.id, onUpdateBranch])

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
          onAgentChange={handleAgentChange}
          onModelChange={handleModelChange}
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

      {/* Agent Switch Confirmation Dialog */}
      <SwitchAgentDialog
        newAgent={pendingAgentSwitch}
        currentAgent={(branch.agent || "claude-code") as Agent}
        onClose={handleAgentSwitchCancel}
        onConfirm={handleAgentSwitchConfirm}
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
