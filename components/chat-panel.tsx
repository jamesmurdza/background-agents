"use client"

import { cn } from "@/lib/utils"
import type { Agent, Branch, Message, UserCredentialFlags } from "@/lib/types"
import { defaultAgentModel, getDefaultModelForAgent, LOOP_CONTINUATION_MESSAGE, DEFAULT_LOOP_MAX_ITERATIONS } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, PATHS } from "@/lib/constants"
import { waitForSSEResult } from "@/lib/sse-utils"
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
  /** Add message to a specific branch - branchId param ensures correct branch even during branch switches */
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  /** Update message in a specific branch - branchId param ensures correct branch even during branch switches */
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
  onForceSave: () => void
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
  messagesLoading?: boolean
  isMobile?: boolean
  /** Ref to signal which message is actively streaming - used by sync to avoid overwriting */
  streamingMessageIdRef?: React.MutableRefObject<string | null>
  /** User credentials for filtering available models */
  credentials?: UserCredentialFlags | null
  /** Callback to open settings modal */
  onOpenSettings?: () => void
  /** Callback to open settings modal with a specific field highlighted */
  onOpenSettingsWithHighlight?: (field: string) => void
  /** Default loop max iterations from user settings */
  defaultLoopMaxIterations?: number
  /** Whether the loop until finished feature is enabled (experimental) */
  loopUntilFinishedEnabled?: boolean
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
  streamingMessageIdRef,
  credentials,
  onOpenSettings,
  onOpenSettingsWithHighlight,
  defaultLoopMaxIterations = DEFAULT_LOOP_MAX_ITERATIONS,
  loopUntilFinishedEnabled = false,
}: ChatPanelProps) {
  // Refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const globalActiveBranchIdRef = useRef<string | null>(branch.id)
  // Keep a ref to the current branch to avoid stale closures in callbacks
  const branchRef = useRef(branch)
  branchRef.current = branch

  // Keep global branch ID ref updated
  useEffect(() => {
    globalActiveBranchIdRef.current = branch.id
  }, [branch.id])

  // Track previous status to detect when sandbox creation completes
  const prevStatusRef = useRef(branch.status)

  // When a new branch is created or when sandbox creation completes, focus the chat input.
  // We focus during CREATING status and also when transitioning from CREATING to IDLE.
  useEffect(() => {
    const wasCreating = prevStatusRef.current === BRANCH_STATUS.CREATING
    const isNowIdle = branch.status === BRANCH_STATUS.IDLE
    const isCreating = branch.status === BRANCH_STATUS.CREATING

    // Update the ref for next render
    prevStatusRef.current = branch.status

    // Focus if currently creating, or if just finished creating (transitioned to idle)
    if (isCreating || (wasCreating && isNowIdle)) {
      const t = window.setTimeout(() => {
        if (textareaRef.current && document.activeElement !== textareaRef.current) {
          textareaRef.current.focus()
        }
      }, 0)
      return () => window.clearTimeout(t)
    }
  }, [branch.id, branch.status])

  // State for agent switch dialog
  const [pendingAgentSwitch, setPendingAgentSwitch] = useState<Agent | null>(null)

  // Custom hooks
  const { input, setInput, isNearBottomRef } = useDraftSync({
    branch,
    onSaveDraftForBranch,
  })

  // Loop continuation handler - sends the continuation message when loop should continue
  // Uses branchRef to avoid stale closure issues when user switches branches during execution
  const handleLoopContinue = useCallback(async (branchId: string) => {
    // Access current branch data via ref to avoid stale closures
    const currentBranch = branchRef.current
    // Only continue if we're still on the same branch that triggered the loop
    if (currentBranch.id !== branchId) return
    if (!currentBranch.sandboxId) return

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: LOOP_CONTINUATION_MESSAGE,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    await onAddMessage(branchId, userMsg)

    const now = Date.now()
    onUpdateBranch(branchId, {
      status: BRANCH_STATUS.RUNNING,
      lastActivity: "now",
      lastActivityTs: now,
    })

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(branchId, assistantMsg)

    try {
      const effectiveAgent = (currentBranch.agent || "claude-code") as Agent
      const effectiveModel = currentBranch.model ?? getDefaultModelForAgent(effectiveAgent, credentials)

      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: currentBranch.sandboxId,
          prompt: LOOP_CONTINUATION_MESSAGE,
          previewUrlPattern: currentBranch.previewUrlPattern,
          repoName,
          messageId,
          agent: effectiveAgent,
          model: effectiveModel,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        // For sandbox deleted during loop, just stop the loop gracefully
        if (response.status === 410 && data.error === "SANDBOX_NOT_FOUND") {
          onUpdateMessage(branchId, messageId, { content: "Sandbox was deleted. Please send a new message to recreate it." })
          onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE, loopCount: 0, loopEnabled: false })
          return
        }
        throw new Error(data.error || "Failed to start agent")
      }

      startPollingRef.current(messageId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(branchId, messageId, { content: `Error: ${message}` })
      onUpdateBranch(branchId, { status: BRANCH_STATUS.IDLE, loopCount: 0 })
    }
  }, [repoName, onAddMessage, onUpdateMessage, onUpdateBranch, credentials])

  // Ref to hold startPolling so loop continue can use it
  const startPollingRef = useRef<(messageId: string, executionId?: string) => void>(() => {})

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
    streamingMessageIdRef,
    globalActiveBranchIdRef,
    onLoopContinue: handleLoopContinue,
  })

  // Update ref after hook returns
  useEffect(() => {
    startPollingRef.current = startPolling
  }, [startPolling])

  const gitActions = useGitActions({
    branch,
    repoName,
    repoFullName,
    repoOwner,
    onUpdateBranch,
    onAddMessage,
    onToggleGitHistory,
  })

  // User can suggest branch names if they have an Anthropic or OpenAI API key
  const canSuggestName = !!(credentials?.hasAnthropicApiKey || credentials?.hasOpenaiApiKey)

  const renaming = useBranchRenaming({
    branch,
    repoName,
    repoFullName,
    onUpdateBranch,
    addSystemMessage: gitActions.addSystemMessage,
    canSuggestName,
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

    setInput("")

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    await onAddMessage(branch.id, userMsg)

    const now = Date.now()
    onUpdateBranch(branch.id, {
      status: BRANCH_STATUS.RUNNING,
      draftPrompt: "",
      lastActivity: "now",
      lastActivityTs: now,
    })

    // Fetch current HEAD and persist it as lastShownCommitHash before starting execution
    // This ensures we can accurately detect new commits made during this execution
    try {
      const headRes = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "head",
        }),
      })
      if (headRes.ok) {
        const headData = await headRes.json()
        if (headData.head) {
          // Persist to server and update local state
          await fetch("/api/branches", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              branchId: branch.id,
              lastShownCommitHash: headData.head,
            }),
          })
          onUpdateBranch(branch.id, { lastShownCommitHash: headData.head })
        }
      }
    } catch {
      // Non-critical - commit detection will fall back to existing behavior
    }

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(branch.id, assistantMsg)
    currentMessageIdRef.current = messageId

    try {
      const effectiveAgent = (branch.agent || "claude-code") as Agent
      const effectiveModel = branch.model ?? getDefaultModelForAgent(effectiveAgent, credentials)

      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          prompt,
          previewUrlPattern: branch.previewUrlPattern,
          repoName,
          messageId,
          agent: effectiveAgent,
          model: effectiveModel,
        }),
      })

      if (!response.ok) {
        const data = await response.json()

        // Handle sandbox deleted - trigger recreation
        if (response.status === 410 && data.error === "SANDBOX_NOT_FOUND" && data.recreateInfo?.branchId) {
          onUpdateMessage(branch.id, messageId, { content: "Sandbox was deleted. Recreating..." })

          // Call sandbox create with existing branch ID to recreate
          const recreateRes = await fetch("/api/sandbox/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              existingBranchId: data.recreateInfo.branchId,
            }),
          })

          if (!recreateRes.ok) {
            let errorMessage = "Failed to recreate sandbox"
            try {
              const errorData = await recreateRes.json()
              errorMessage = errorData.message || errorData.error || errorMessage
            } catch {
              errorMessage = `Failed to recreate sandbox: ${recreateRes.status} ${recreateRes.statusText}`
            }
            throw new Error(errorMessage)
          }

          // Parse SSE response to get new sandbox info
          const sseResult = await waitForSSEResult<{ sandboxId: string; previewUrlPattern?: string; type: string }>(recreateRes)
          if (!sseResult.success) {
            throw new Error(`Failed to recreate sandbox: ${sseResult.error}`)
          }

          const { sandboxId, previewUrlPattern } = sseResult.data
          if (!sandboxId) {
            throw new Error("Failed to recreate sandbox: No sandbox ID returned")
          }

          // Update branch with new sandbox info and retry the message
          onUpdateBranch(branch.id, { sandboxId, previewUrlPattern: previewUrlPattern ?? undefined })
          onUpdateMessage(branch.id, messageId, { content: "" })

          // Retry the original request with new sandbox
          const retryRes = await fetch("/api/agent/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sandboxId,
              prompt,
              previewUrlPattern,
              repoName,
              messageId,
              agent: effectiveAgent,
              model: effectiveModel,
            }),
          })

          if (!retryRes.ok) {
            const retryData = await retryRes.json().catch(() => ({}))
            throw new Error(retryData.error || retryData.message || "Failed to start agent after sandbox recreation")
          }

          console.log(`[POLLER-DEBUG] ChatPanel calling startPolling after sandbox recreation for branch ${branch.id}`)
          startPolling(messageId)
          return
        }

        throw new Error(data.error || "Failed to start agent")
      }

      console.log(`[POLLER-DEBUG] ChatPanel calling startPolling for branch ${branch.id}`)
      startPolling(messageId)

      // Auto-suggest branch name on first message if user hasn't changed the default name
      // This runs in the background and doesn't block message sending
      if (branch.messages.length === 0 && canSuggestName) {
        renaming.autoSuggestBranchName()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(branch.id, messageId, { content: `Error: ${message}` })
      onUpdateBranch(branch.id, { status: BRANCH_STATUS.IDLE })
      currentMessageIdRef.current = null
      currentExecutionIdRef.current = null
    }
  }, [input, branch, repoName, onAddMessage, onUpdateMessage, onUpdateBranch, startPolling, currentMessageIdRef, currentExecutionIdRef, setInput, credentials, canSuggestName, renaming])

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

  // Apply agent switch in local state only; persisted to server when user sends
  const performAgentSwitch = useCallback((agent: Agent) => {
    // Use the best available model for this agent given user's credentials
    const model = getDefaultModelForAgent(agent, credentials)
    onUpdateBranch(branch.id, { agent, model })
  }, [branch.id, onUpdateBranch, credentials])

  // Handle agent change: only warn when switching to a *different* agent; no warning when changing back to current
  const handleAgentChange = useCallback((agent: Agent) => {
    const currentAgent = (branch.agent || "claude-code") as Agent
    if (agent === currentAgent) return

    if (branch.messages.length > 0) {
      setPendingAgentSwitch(agent)
      return
    }

    // Use the best available model for this agent given user's credentials
    const model = getDefaultModelForAgent(agent, credentials)
    onUpdateBranch(branch.id, { agent, model })
  }, [branch.id, branch.agent, branch.messages.length, onUpdateBranch, credentials])

  // Handle agent switch confirmation
  const handleAgentSwitchConfirm = useCallback((agent: Agent) => {
    performAgentSwitch(agent)
    setPendingAgentSwitch(null)
  }, [performAgentSwitch])

  // Handle agent switch cancellation
  const handleAgentSwitchCancel = useCallback(() => {
    setPendingAgentSwitch(null)
  }, [])

  // Handle model change (local state only; persisted when user sends)
  const handleModelChange = useCallback((model: string) => {
    onUpdateBranch(branch.id, { model })
  }, [branch.id, onUpdateBranch])

  // Handle loop toggle
  const handleLoopToggle = useCallback(async (enabled: boolean) => {
    // Update branch with loop settings
    const updates: Partial<Branch> = {
      loopEnabled: enabled,
      loopCount: 0, // Reset count when toggling
    }
    // If enabling, set max iterations from user setting
    if (enabled) {
      updates.loopMaxIterations = defaultLoopMaxIterations
    }
    onUpdateBranch(branch.id, updates)

    // Persist to server
    try {
      await fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: branch.id,
          loopEnabled: enabled,
          loopCount: 0,
          ...(enabled && { loopMaxIterations: defaultLoopMaxIterations }),
        }),
      })
    } catch (err) {
      console.error("Failed to persist loop toggle:", err)
    }
  }, [branch.id, onUpdateBranch, defaultLoopMaxIterations])

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
          onLoopToggle={handleLoopToggle}
          onOpenSettings={onOpenSettings}
          onOpenSettingsWithHighlight={onOpenSettingsWithHighlight}
          credentials={credentials}
          defaultLoopMaxIterations={defaultLoopMaxIterations}
          loopUntilFinishedEnabled={loopUntilFinishedEnabled}
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
