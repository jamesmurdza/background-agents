"use client"

import { cn } from "@/lib/shared/utils"
import type { Agent, Branch, Message, PushErrorInfo, UserCredentialFlags } from "@/lib/shared/types"
import { defaultAgentModel, getDefaultModelForAgent } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { ASSISTANT_SOURCE, BRANCH_STATUS, PATHS } from "@/lib/shared/constants"
import { waitForSSEResult } from "@upstream/common"
import { Terminal } from "lucide-react"
import { useRef, useEffect, useCallback, useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SwitchAgentDialog } from "@/components/modals/switch-agent-dialog"

// Import hooks
import {
  useDraftSync,
  useGitActions,
  useBranchRenaming,
} from "@/components/chat/hooks"
import { useExecutionStore } from "@/lib/stores/execution-store"

// Import sub-components
import { ChatHeader } from "@/components/chat/chat-header"
import { MessageList } from "@/components/chat/message-list"
import { ChatInput } from "@/components/chat/chat-input"
import { ChatDialogs } from "@/components/chat/chat-dialogs"

function focusTextareaAtEnd(el: HTMLTextAreaElement) {
  el.focus()
  const n = el.value.length
  if (n > 0) {
    el.setSelectionRange(n, n)
  }
}

type ExecuteErrorBody = {
  error?: string
  message?: string
  recreateInfo?: { branchId?: string }
}

/** Read body as text then parse JSON so empty/non-JSON error responses (timeouts, proxies) don't break the UI. */
async function readExecuteErrorResponse(response: Response): Promise<{
  data: ExecuteErrorBody
  rawText: string
}> {
  const rawText = await response.text()
  const trimmed = rawText.trim()
  if (!trimmed) {
    return { data: {}, rawText }
  }
  try {
    return { data: JSON.parse(trimmed) as ExecuteErrorBody, rawText }
  } catch {
    return { data: {}, rawText: trimmed }
  }
}

function executeHttpErrorMessage(response: Response, data: ExecuteErrorBody, rawText: string): string {
  if (typeof data.error === "string" && data.error.length > 0) return data.error
  if (typeof data.message === "string" && data.message.length > 0) return data.message
  const t = rawText.trim()
  if (t.length > 0) return t.length > 800 ? `${t.slice(0, 800)}…` : t
  return `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`
}

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
  /** Notifies parent when rebase conflict state changes (e.g. for layout chrome) */
  onRebaseConflictChange?: (inRebaseConflict: boolean) => void
  /** Resolve any branch by id. */
  getBranchById?: (branchId: string) => Branch | undefined
  executionRefreshGitRef?: React.MutableRefObject<(() => void) | null>
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
  onRebaseConflictChange,
  getBranchById,
  executionRefreshGitRef,
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

  // Desktop: focus the prompt when switching branches (not on id migration client→server).
  const prevBranchFocusRef = useRef({
    id: branch.id,
    name: branch.name,
    repoFullName,
  })
  useEffect(() => {
    if (isMobile) {
      prevBranchFocusRef.current = { id: branch.id, name: branch.name, repoFullName }
      return
    }
    const prev = prevBranchFocusRef.current
    const isIdMigration =
      prev.repoFullName === repoFullName &&
      prev.name === branch.name &&
      prev.id !== branch.id
    const switchedBranch = prev.id !== branch.id && !isIdMigration
    prevBranchFocusRef.current = { id: branch.id, name: branch.name, repoFullName }

    if (!switchedBranch) return

    const t = window.setTimeout(() => {
      const el = textareaRef.current
      if (el && document.activeElement !== el) {
        focusTextareaAtEnd(el)
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [branch.id, branch.name, repoFullName, isMobile])

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
        const el = textareaRef.current
        if (el && document.activeElement !== el) {
          focusTextareaAtEnd(el)
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

  const runAgentExecute = useCallback(
    async (args: {
      branchId: string
      messageId: string
      prompt: string
      b: Branch
    }) => {
      const { branchId, messageId, prompt, b } = args
      if (!b.sandboxId) throw new Error("No sandbox")

      const finishExecuteSuccess = async (res: Response, fallbackBranch: Branch) => {
        const data = (await res.json()) as { executionId?: string }
        const executionId = typeof data.executionId === "string" ? data.executionId : messageId
        const snap =
          branchRef.current.id === branchId ? branchRef.current : (getBranchById?.(branchId) ?? fallbackBranch)
        useExecutionStore.getState().startExecution({
          messageId,
          executionId,
          branchId,
          sandboxId: snap.sandboxId || "",
          repoName,
          repoOwner,
          repoApiName: repoName,
          branchName: snap.name,
          lastShownCommitHash: snap.lastShownCommitHash || null,
          messages: snap.messages,
        })
      }

      const effectiveAgent = (b.agent || "claude-code") as Agent
      const effectiveModel = b.model ?? getDefaultModelForAgent(effectiveAgent, credentials)

      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: b.sandboxId,
          prompt,
          previewUrlPattern: b.previewUrlPattern,
          repoName,
          messageId,
          agent: effectiveAgent,
          model: effectiveModel,
        }),
      })

      if (!response.ok) {
        const { data, rawText } = await readExecuteErrorResponse(response)

        if (response.status === 410 && data.error === "SANDBOX_NOT_FOUND" && data.recreateInfo?.branchId) {
          onUpdateMessage(branchId, messageId, { content: "Sandbox was deleted. Recreating..." })

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

          const sseResult = await waitForSSEResult<{ sandboxId: string; previewUrlPattern?: string; type: string }>(recreateRes)
          if (!sseResult.success) {
            throw new Error(`Failed to recreate sandbox: ${sseResult.error}`)
          }

          const { sandboxId, previewUrlPattern } = sseResult.data
          if (!sandboxId) {
            throw new Error("Failed to recreate sandbox: No sandbox ID returned")
          }

          onUpdateBranch(branchId, { sandboxId, previewUrlPattern: previewUrlPattern ?? undefined })
          onUpdateMessage(branchId, messageId, { content: "" })

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
            const { data: rData, rawText: rRaw } = await readExecuteErrorResponse(retryRes)
            throw new Error(executeHttpErrorMessage(retryRes, rData, rRaw) || "Failed to start agent after sandbox recreation")
          }

          const merged: Branch = {
            ...b,
            sandboxId,
            previewUrlPattern: previewUrlPattern ?? b.previewUrlPattern,
          }
          await finishExecuteSuccess(retryRes, merged)
          return
        }

        throw new Error(executeHttpErrorMessage(response, data, rawText) || "Failed to start agent")
      }

      await finishExecuteSuccess(response, b)
    },
    [credentials, getBranchById, onUpdateBranch, onUpdateMessage, repoName]
  )

  const gitActions = useGitActions({
    branch,
    repoName,
    repoFullName,
    repoOwner,
    onUpdateBranch,
    onAddMessage,
    onUpdateMessage,
    onToggleGitHistory,
    defaultSquashOnMerge: credentials?.squashOnMerge,
  })

  const refreshGitConflictState = useCallback(() => {
    void gitActions.gitDialogs.checkRebaseStatus()
  }, [gitActions.gitDialogs.checkRebaseStatus])

  useEffect(() => {
    const r = gitActions.gitDialogs.rebaseConflict
    onRebaseConflictChange?.(!!(r?.inRebase || r?.inMerge))
  }, [gitActions.gitDialogs.rebaseConflict?.inRebase, gitActions.gitDialogs.rebaseConflict?.inMerge, onRebaseConflictChange])


  useEffect(() => {
    if (executionRefreshGitRef) {
      executionRefreshGitRef.current = refreshGitConflictState
    }
  }, [executionRefreshGitRef, refreshGitConflictState])

  const handleRetryExecute = useCallback(
    async (messageId: string): Promise<{ success: boolean; error?: string }> => {
      const msg = branchRef.current.messages.find((m) => m.id === messageId)
      const info = msg?.executeError
      if (!info) return { success: false, error: "Nothing to retry" }

      const b = branchRef.current
      onUpdateMessage(b.id, messageId, { content: "", executeError: undefined })
      onUpdateBranch(b.id, {
        status: BRANCH_STATUS.RUNNING,
        lastActivity: "now",
        lastActivityTs: Date.now(),
      })

      try {
        await runAgentExecute({
          branchId: b.id,
          messageId,
          prompt: info.prompt,
          b,
        })
        return { success: true }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error"
        onUpdateMessage(b.id, messageId, {
          content: "",
          executeError: { errorMessage: errMsg, prompt: info.prompt },
        })
        onUpdateBranch(b.id, { status: BRANCH_STATUS.IDLE })
        return { success: false, error: errMsg }
      }
    },
    [onUpdateBranch, onUpdateMessage, runAgentExecute]
  )

  const handleClearExecuteError = useCallback(
    (messageId: string) => {
      onUpdateMessage(branch.id, messageId, { executeError: undefined })
    },
    [branch.id, onUpdateMessage]
  )

  const canSuggestName = !!(
    credentials?.hasAnthropicApiKey ||
    credentials?.hasOpenaiApiKey ||
    credentials?.hasServerLlmFallback
  )

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

    // Show spinner immediately — onUpdateBranch sets local state AND persists
    // to DB, so sync won't revert it back to "idle".
    onUpdateBranch(branch.id, {
      status: BRANCH_STATUS.RUNNING,
      draftPrompt: "",
      lastActivity: "now",
      lastActivityTs: Date.now(),
    })

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    await onAddMessage(branch.id, userMsg)

    // Fetch HEAD before starting execution (for commit detection)
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
      // Non-critical
    }

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      assistantSource: ASSISTANT_SOURCE.MODEL,
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(branch.id, assistantMsg)

    try {
      await runAgentExecute({
        branchId: branch.id,
        messageId,
        prompt,
        b: branch,
      })

      if (branch.messages.length === 0 && canSuggestName) {
        renaming.autoSuggestBranchName(prompt)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(branch.id, messageId, {
        content: "",
        executeError: { errorMessage: message, prompt },
      })
      onUpdateBranch(branch.id, { status: BRANCH_STATUS.IDLE })
    }
  }, [input, branch, repoName, onAddMessage, onUpdateMessage, onUpdateBranch, setInput, canSuggestName, renaming, runAgentExecute])

  // Stop handler — stop global execution polling when this message is tracked
  const handleStop = useCallback(() => {
    const lastMsg = branch.messages.filter(m => m.role === "assistant").at(-1)
    if (lastMsg && useExecutionStore.getState().isStreaming(lastMsg.id)) {
      useExecutionStore.getState().stopExecution(lastMsg.id)
    } else if (lastMsg) {
      const content = lastMsg.content ?? ""
      onUpdateMessage(branch.id, lastMsg.id, {
        content: content ? `${content}\n\n[Stopped by user]` : "[Stopped by user]",
      })
      onUpdateBranch(branch.id, {
        status: BRANCH_STATUS.IDLE,
      })
    } else {
      onUpdateBranch(branch.id, {
        status: BRANCH_STATUS.IDLE,
      })
    }
    abortControllerRef.current?.abort()
  }, [branch.id, branch.messages, onUpdateMessage, onUpdateBranch])

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

  // Handle push retry - force-push to sync diverged history (preserves PRs)
  const handleRetryPush = useCallback(async (pushError: PushErrorInfo): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: pushError.sandboxId,
          repoPath: pushError.repoPath,
          action: "force-push",
          currentBranch: pushError.branchName,
          repoOwner: pushError.repoOwner,
          repoApiName: pushError.repoApiName,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error: (errorData as { error?: string }).error || `Failed with status ${response.status}`,
        }
      }

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }
    }
  }, [])

  // Clear push error from a message
  const handleClearPushError = useCallback((messageId: string) => {
    // Find the message and update it to remove pushError
    const message = branch.messages.find((m) => m.id === messageId)
    if (message) {
      // Update the message to remove pushError and update content
      onUpdateMessage(branch.id, messageId, {
        content: "::icon-success:: **Force push succeeded.**",
        pushError: undefined,
      })
    }
  }, [branch.id, branch.messages, onUpdateMessage])

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
            rebaseConflict={gitActions.gitDialogs.rebaseConflict}
            onAbortConflict={gitActions.gitDialogs.handleAbortConflict}
          />
        )}

        {/* Messages */}
        <MessageList
          ref={scrollRef}
          branch={branch}
          repoPath={`${PATHS.SANDBOX_HOME}/${repoName}`}
          messagesLoading={messagesLoading}
          isMobile={isMobile}
          onScroll={handleScroll}
          onCommitClick={handleCommitClick}
          onBranchFromCommit={onBranchFromCommit}
          onRetryPush={handleRetryPush}
          onClearPushError={handleClearPushError}
          onRetryExecute={handleRetryExecute}
          onClearExecuteError={handleClearExecuteError}
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
          onOpenSettings={onOpenSettings}
          onOpenSettingsWithHighlight={onOpenSettingsWithHighlight}
          credentials={credentials}
          isMobile={isMobile}
          inRebaseConflict={
            !!(gitActions.gitDialogs.rebaseConflict?.inRebase || gitActions.gitDialogs.rebaseConflict?.inMerge)
          }
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
