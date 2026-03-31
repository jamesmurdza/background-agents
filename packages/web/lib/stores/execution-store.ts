/**
 * Execution Polling Store using Zustand
 *
 * Manages active agent executions and provides a global polling mechanism.
 * This replaces the React-based useExecutionPolling hook with a simpler,
 * more robust architecture that:
 *
 * 1. Keys executions by messageId (globally unique, immutable)
 * 2. Runs a single global polling loop outside React lifecycle
 * 3. Eliminates race conditions from closure captures and ref overwrites
 * 4. Supports multiple concurrent executions across branches
 */

import { create } from "zustand"
import { devtools } from "zustand/middleware"
import type { Branch, Message, ToolCall, ContentBlock } from "@/lib/shared/types"
import { BRANCH_STATUS, EXECUTION_STATUS } from "@/lib/shared/constants"
import {
  addToolCallIds,
  addContentBlockIds,
  buildErrorContent,
  shouldContinueLoop,
  MAX_NOT_FOUND_RETRIES,
  STOPPED_WITHOUT_END_NOTE,
} from "@/lib/core/polling"
import { isLoopFinished } from "@/lib/shared/types"
import { detectAndShowCommits } from "@/lib/core/execution/detect-and-show-commits"

// =============================================================================
// Types
// =============================================================================

export interface ExecutionContext {
  messageId: string
  executionId: string
  branchId: string
  // Context captured at execution start (immutable for this execution)
  sandboxId: string
  repoName: string
  repoOwner: string
  repoApiName: string
  branchName: string
  lastShownCommitHash: string | null
  messages: Message[]
  // Loop mode state
  loopEnabled: boolean
  loopCount: number
  loopMaxIterations: number
  // Polling state
  notFoundRetries: number
  highestSnapshotVersion: number
  completionHandled: boolean
}

interface ExecutionState {
  // Map of messageId -> execution context
  activeExecutions: Map<string, ExecutionContext>

  // Currently active branch ID (for determining unread state)
  activeBranchId: string | null

  // Callback refs - set by React components, called by polling manager
  // These are stored here so the polling manager can update React state
  callbacks: {
    onUpdateMessage: ((branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>) | null
    onUpdateBranch: ((branchId: string, updates: Partial<Branch>) => void) | null
    onAddMessage: ((branchId: string, message: Message) => Promise<string>) | null
    onForceSave: (() => void) | null
    onCommitsDetected: (() => void) | null
    onLoopContinue: ((branchId: string) => void) | null
    onRefreshGitConflictState: (() => void) | null
  }
}

interface ExecutionActions {
  // Register a new execution for polling
  startExecution: (context: Omit<ExecutionContext, 'notFoundRetries' | 'highestSnapshotVersion' | 'completionHandled'>) => void

  // Stop polling for an execution
  stopExecution: (messageId: string) => void

  // Clear an execution from the store (after completion)
  clearExecution: (messageId: string) => void

  // Update execution state (used by polling manager)
  updateExecution: (messageId: string, updates: Partial<ExecutionContext>) => void

  // Check if a message is currently being streamed
  isStreaming: (messageId: string) => boolean

  // Set callbacks (called by React components on mount)
  setCallbacks: (callbacks: Partial<ExecutionState['callbacks']>) => void

  // Get execution by messageId
  getExecution: (messageId: string) => ExecutionContext | undefined

  // Set active branch ID (for determining unread state on completion)
  setActiveBranchId: (branchId: string | null) => void
}

// =============================================================================
// Store
// =============================================================================

const initialState: ExecutionState = {
  activeExecutions: new Map(),
  activeBranchId: null,
  callbacks: {
    onUpdateMessage: null,
    onUpdateBranch: null,
    onAddMessage: null,
    onForceSave: null,
    onCommitsDetected: null,
    onLoopContinue: null,
    onRefreshGitConflictState: null,
  },
}

const storeCreator = (
  set: (partial: Partial<ExecutionState> | ((state: ExecutionState) => Partial<ExecutionState>)) => void,
  get: () => ExecutionState & ExecutionActions
) => ({
  ...initialState,

  startExecution: (context: Omit<ExecutionContext, 'notFoundRetries' | 'highestSnapshotVersion' | 'completionHandled'>) => {
    set((state) => {
      const newExecutions = new Map(state.activeExecutions)
      newExecutions.set(context.messageId, {
        ...context,
        notFoundRetries: 0,
        highestSnapshotVersion: 0,
        completionHandled: false,
      })
      return { activeExecutions: newExecutions }
    })
  },

  stopExecution: (messageId: string) => {
    const execution = get().activeExecutions.get(messageId)
    if (!execution) return

    // Mark as stopped and let polling manager handle cleanup
    set((state) => {
      const newExecutions = new Map(state.activeExecutions)
      newExecutions.delete(messageId)
      return { activeExecutions: newExecutions }
    })

    // Update UI state
    const { callbacks } = get()
    if (callbacks.onUpdateMessage) {
      const lastMsg = execution.messages.find(m => m.id === messageId)
      const currentContent = lastMsg?.content ?? ""
      callbacks.onUpdateMessage(execution.branchId, messageId, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]",
      })
    }
    if (callbacks.onUpdateBranch) {
      callbacks.onUpdateBranch(execution.branchId, {
        status: BRANCH_STATUS.IDLE,
        loopEnabled: false,
        loopCount: 0,
      })
    }
  },

  clearExecution: (messageId: string) => {
    set((state) => {
      const newExecutions = new Map(state.activeExecutions)
      newExecutions.delete(messageId)
      return { activeExecutions: newExecutions }
    })
  },

  updateExecution: (messageId: string, updates: Partial<ExecutionContext>) => {
    set((state) => {
      const existing = state.activeExecutions.get(messageId)
      if (!existing) return state

      const newExecutions = new Map(state.activeExecutions)
      newExecutions.set(messageId, { ...existing, ...updates })
      return { activeExecutions: newExecutions }
    })
  },

  isStreaming: (messageId: string) => {
    return get().activeExecutions.has(messageId)
  },

  setCallbacks: (callbacks: Partial<ExecutionState['callbacks']>) => {
    set((state) => ({
      callbacks: { ...state.callbacks, ...callbacks },
    }))
  },

  getExecution: (messageId: string) => {
    return get().activeExecutions.get(messageId)
  },

  setActiveBranchId: (branchId: string | null) => {
    set({ activeBranchId: branchId })
  },
})

// Only use devtools in development
export const useExecutionStore =
  process.env.NODE_ENV === "development"
    ? create<ExecutionState & ExecutionActions>()(devtools(storeCreator, { name: "execution-store" }))
    : create<ExecutionState & ExecutionActions>()(storeCreator)

// =============================================================================
// Polling Manager (runs outside React)
// =============================================================================

let pollingInterval: ReturnType<typeof setInterval> | null = null
let pollInFlight = false

/**
 * Fetches execution status from the API
 * Note: We only use messageId since it uniquely identifies the execution.
 * The executionId field in the DB schema is optional and may not be set.
 */
async function fetchExecutionStatus(messageId: string): Promise<{
  status: string
  snapshotVersion: number
  content: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
  error?: string
  agentCrashed?: { message?: string; output?: string }
} | null> {
  try {
    const res = await fetch("/api/agent/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    })

    if (!res.ok) {
      if (res.status === 404) {
        return null // Not found
      }
      const data = await res.json().catch(() => ({}))
      console.error("[execution-poll] poll error", data.error)
      return null
    }

    return await res.json()
  } catch (err) {
    console.error("[execution-poll] fetch failed", err)
    return null
  }
}

/**
 * Processes a single execution poll response
 */
async function processExecution(messageId: string): Promise<void> {
  // Get fresh state on each call - don't use stale snapshots!
  // This ensures we always have the latest callbacks from React
  const store = useExecutionStore.getState()
  const execution = store.activeExecutions.get(messageId)
  if (!execution) return

  const { callbacks } = store

  const data = await fetchExecutionStatus(messageId)

  // Handle not found
  if (data === null) {
    const newRetries = execution.notFoundRetries + 1
    if (newRetries >= MAX_NOT_FOUND_RETRIES) {
      // Max retries exceeded - mark as stopped
      if (callbacks.onUpdateMessage) {
        const lastMsg = execution.messages.find(m => m.id === messageId)
        const currentContent = lastMsg?.content ?? ""
        callbacks.onUpdateMessage(execution.branchId, messageId, {
          content: currentContent + STOPPED_WITHOUT_END_NOTE,
        })
      }
      if (callbacks.onUpdateBranch) {
        callbacks.onUpdateBranch(execution.branchId, { status: BRANCH_STATUS.IDLE })
      }
      store.clearExecution(messageId)
    } else {
      store.updateExecution(messageId, { notFoundRetries: newRetries })
    }
    return
  }

  // Reset retry counter on successful response
  if (execution.notFoundRetries > 0) {
    store.updateExecution(messageId, { notFoundRetries: 0 })
  }

  // Reject stale responses using monotonic snapshotVersion
  const responseVersion = typeof data.snapshotVersion === "number" ? data.snapshotVersion : 0
  if (responseVersion < execution.highestSnapshotVersion) {
    return // Stale response
  }
  store.updateExecution(messageId, { highestSnapshotVersion: responseVersion })

  // Handle unexpected status (not running, completed, or error)
  if (
    data.status != null &&
    data.status !== EXECUTION_STATUS.RUNNING &&
    data.status !== EXECUTION_STATUS.COMPLETED &&
    data.status !== EXECUTION_STATUS.ERROR
  ) {
    if (callbacks.onUpdateMessage) {
      const lastMsg = execution.messages.find(m => m.id === messageId)
      const currentContent = lastMsg?.content ?? ""
      callbacks.onUpdateMessage(execution.branchId, messageId, {
        content: currentContent + STOPPED_WITHOUT_END_NOTE,
      })
    }
    if (callbacks.onUpdateBranch) {
      callbacks.onUpdateBranch(execution.branchId, { status: BRANCH_STATUS.IDLE })
    }
    store.clearExecution(messageId)
    return
  }

  // Update message content
  const hasContent = data.content || (data.toolCalls?.length > 0) || (data.contentBlocks?.length > 0)
  if (hasContent && callbacks.onUpdateMessage) {
    const toolCallsWithIds = addToolCallIds(data.toolCalls || []) as ToolCall[]
    const contentBlocksWithIds = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]

    callbacks.onUpdateMessage(execution.branchId, messageId, {
      content: data.content || "",
      toolCalls: toolCallsWithIds,
      contentBlocks: contentBlocksWithIds.length > 0 ? contentBlocksWithIds : undefined,
    })
  }

  // Handle completion
  if (data.status === EXECUTION_STATUS.COMPLETED || data.status === EXECUTION_STATUS.ERROR) {
    // Only handle completion once
    if (execution.completionHandled) return
    store.updateExecution(messageId, { completionHandled: true })

    // Final message update
    const finalToolCalls = addToolCallIds(data.toolCalls || []) as ToolCall[]
    const finalContentBlocks = addContentBlockIds(data.contentBlocks || []) as ContentBlock[]

    let finalContent = data.content || ""
    const hasNoOutput = !finalContent && finalToolCalls.length === 0 && finalContentBlocks.length === 0
    if (data.status === EXECUTION_STATUS.COMPLETED && hasNoOutput) {
      finalContent = STOPPED_WITHOUT_END_NOTE.trim()
    }

    if (callbacks.onUpdateMessage) {
      const savePromise = callbacks.onUpdateMessage(execution.branchId, messageId, {
        content: finalContent,
        toolCalls: finalToolCalls,
        contentBlocks: finalContentBlocks.length > 0 ? finalContentBlocks : undefined,
      })
      if (savePromise) await savePromise
    }

    // Handle error
    if (data.status === EXECUTION_STATUS.ERROR && callbacks.onUpdateMessage) {
      const content = buildErrorContent(data.content ?? "", data.error, data.agentCrashed)
      if (content !== (data.content ?? "")) {
        const errSave = callbacks.onUpdateMessage(execution.branchId, messageId, { content })
        if (errSave) await errSave
      }
    }

    callbacks.onForceSave?.()

    if (callbacks.onAddMessage && callbacks.onUpdateMessage) {
      await detectAndShowCommits({
        runAutoCommit: true,
        sandboxId: execution.sandboxId,
        branchId: execution.branchId,
        branchName: execution.branchName,
        repoName: execution.repoName,
        repoOwner: execution.repoOwner,
        repoApiName: execution.repoApiName,
        lastShownCommitHash: execution.lastShownCommitHash,
        messages: execution.messages,
        onAddMessage: callbacks.onAddMessage,
        onUpdateMessage: callbacks.onUpdateMessage,
        onUpdateBranch: callbacks.onUpdateBranch ?? undefined,
        onCommitsDetected: callbacks.onCommitsDetected ?? undefined,
        onRefreshGitConflictState: callbacks.onRefreshGitConflictState ?? undefined,
      })
    }

    // Check loop continuation
    const loopShouldContinue = shouldContinueLoop(
      data.status as 'completed' | 'error',
      execution.loopEnabled,
      execution.loopCount,
      execution.loopMaxIterations,
      data.content || "",
      isLoopFinished
    )

    if (loopShouldContinue && callbacks.onUpdateBranch && callbacks.onLoopContinue) {
      const newLoopCount = execution.loopCount + 1
      callbacks.onUpdateBranch(execution.branchId, {
        status: BRANCH_STATUS.RUNNING,
        loopCount: newLoopCount,
        lastActivity: "now",
        lastActivityTs: Date.now(),
      })
      callbacks.onLoopContinue(execution.branchId)
    } else {
      // Normal completion
      const loopUpdates = execution.loopEnabled ? { loopCount: 0 } : {}

      // Check if this is a background branch (not currently active)
      // If so, mark it as unread so the user knows there's new content
      const isBackgroundBranch = store.activeBranchId !== execution.branchId
      const unreadUpdate = isBackgroundBranch ? { unread: true } : {}

      if (callbacks.onUpdateBranch) {
        callbacks.onUpdateBranch(execution.branchId, {
          status: BRANCH_STATUS.IDLE,
          lastActivity: "now",
          lastActivityTs: Date.now(),
          ...loopUpdates,
          ...unreadUpdate,
        })
      }

      // Play completion sound
      try {
        const ctx = new AudioContext()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880
        osc.type = "sine"
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.3)
      } catch {
        // Ignore audio errors
      }
    }

    // Clear execution
    store.clearExecution(messageId)
  }
}

/**
 * Main polling loop - processes all active executions
 */
async function pollAllExecutions(): Promise<void> {
  if (pollInFlight) return
  pollInFlight = true

  try {
    const store = useExecutionStore.getState()
    const executions = Array.from(store.activeExecutions.keys())

    if (executions.length === 0) return

    // Poll all executions in parallel
    // Note: processExecution gets fresh state internally, so we don't pass the store
    await Promise.all(
      executions.map(messageId => processExecution(messageId))
    )
  } catch (err) {
    console.error("[execution-poll] poll loop error", err)
  } finally {
    pollInFlight = false
  }
}

/**
 * Start the global polling manager
 * Should be called once at app initialization
 */
export function startPollingManager(): void {
  if (pollingInterval) return

  pollingInterval = setInterval(pollAllExecutions, 500)
}

/**
 * Stop the global polling manager
 * Should be called on app unmount (if needed)
 */
export function stopPollingManager(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

/**
 * Check if any execution is active (for cross-device sync to skip)
 */
export function hasActiveExecutions(): boolean {
  return useExecutionStore.getState().activeExecutions.size > 0
}

/**
 * Check if a specific message is being streamed
 */
export function isMessageStreaming(messageId: string): boolean {
  return useExecutionStore.getState().activeExecutions.has(messageId)
}

/**
 * Recovery: Fetch all active executions from server and resume polling.
 * Should be called once at app startup after authentication.
 */
let recoveryAttempted = false
export async function recoverActiveExecutions(): Promise<void> {
  // Only attempt recovery once per app session
  if (recoveryAttempted) return
  recoveryAttempted = true

  try {
    const res = await fetch("/api/agent/execution/all-active")
    if (!res.ok) return

    const data = await res.json()
    if (!data.executions || data.executions.length === 0) return

    const store = useExecutionStore.getState()

    for (const exec of data.executions) {
      // Skip if already tracking this execution
      if (store.activeExecutions.has(exec.messageId)) continue

      // Start polling for this execution
      store.startExecution({
        messageId: exec.messageId,
        executionId: exec.executionId || exec.messageId,
        branchId: exec.branchId,
        sandboxId: exec.sandboxId || "",
        repoName: exec.repoName,
        repoOwner: exec.repoOwner,
        repoApiName: exec.repoName,
        branchName: exec.branchName,
        lastShownCommitHash: exec.lastShownCommitHash || null,
        messages: [], // Will be populated by polling
        loopEnabled: exec.loopEnabled || false,
        loopCount: exec.loopCount || 0,
        loopMaxIterations: exec.loopMaxIterations || 10,
      })
    }
  } catch {
    // Recovery failed - not critical, polling just won't resume
  }
}
