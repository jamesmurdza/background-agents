/**
 * Pure state machine for execution polling.
 *
 * This module contains zero dependencies on React, fetch, or timers.
 * All logic is expressed as pure functions that take state and return new state + effects.
 *
 * Effects are returned as data, not executed - the caller (React hook) is responsible
 * for interpreting and executing them.
 */

// =============================================================================
// Types
// =============================================================================

export type PollingStatus = 'idle' | 'polling' | 'completed' | 'error' | 'stopped'

export interface PollingState {
  status: PollingStatus
  messageId: string | null
  executionId: string | null
  branchId: string | null
  notFoundRetries: number
  completionHandled: boolean
  pollInFlight: boolean
}

export interface StatusResponse {
  status: 'running' | 'completed' | 'error' | string
  content?: string
  toolCalls?: ToolCall[]
  contentBlocks?: ContentBlock[]
  error?: string
  agentCrashed?: { message?: string; output?: string }
}

export interface ToolCall {
  tool: string
  summary: string
  fullSummary?: string
  filePath?: string
  output?: string
}

export interface ContentBlock {
  type: string
  text?: string
  toolCalls?: ToolCall[]
}

// Effects that the polling state machine can request
export type PollingEffect =
  | { type: 'SCHEDULE_POLL' }
  | { type: 'CANCEL_POLL' }
  | { type: 'UPDATE_MESSAGE'; content: string; toolCalls: ToolCallWithId[]; contentBlocks: ContentBlockWithId[] }
  | { type: 'DETECT_COMMITS'; runAutoCommit: boolean }
  | { type: 'PLAY_COMPLETION_SOUND' }
  | { type: 'SET_BRANCH_IDLE'; unread: boolean }
  | { type: 'SET_BRANCH_RUNNING' }
  | { type: 'CLEAR_STREAMING_REF'; messageId: string; delayMs: number }
  | { type: 'FORCE_SAVE' }
  | { type: 'APPEND_STOPPED_NOTE' }
  | { type: 'APPEND_ERROR'; error: string; agentCrashed?: { message?: string; output?: string } }

export interface ToolCallWithId extends ToolCall {
  id: string
  timestamp: string
}

export interface ContentBlockWithId {
  type: string
  text?: string
  toolCalls?: ToolCallWithId[]
}

// Actions that can be dispatched to the state machine
export type PollingAction =
  | { type: 'START'; messageId: string; executionId?: string; branchId: string }
  | { type: 'POLL_STARTED' }
  | { type: 'POLL_RESPONSE'; response: StatusResponse }
  | { type: 'POLL_NOT_FOUND' }
  | { type: 'POLL_ERROR'; error: string }
  | { type: 'POLL_FINISHED' }
  | { type: 'STOP' }
  | { type: 'RESET' }

// =============================================================================
// Constants
// =============================================================================

export const MAX_NOT_FOUND_RETRIES = 10

export const STOPPED_WITHOUT_END_NOTE = "\n\n---\n*Agent stopped without responding. Please try again.*"

// =============================================================================
// Initial State
// =============================================================================

export const initialPollingState: PollingState = {
  status: 'idle',
  messageId: null,
  executionId: null,
  branchId: null,
  notFoundRetries: 0,
  completionHandled: false,
  pollInFlight: false,
}

// =============================================================================
// Pure State Transitions
// =============================================================================

export interface PollingTransitionResult {
  state: PollingState
  effects: PollingEffect[]
}

/**
 * Pure reducer for polling state transitions.
 * Given current state and an action, returns new state and effects to execute.
 */
export function pollingReducer(
  state: PollingState,
  action: PollingAction
): PollingTransitionResult {
  switch (action.type) {
    case 'START': {
      // Prevent concurrent polling
      if (state.status === 'polling') {
        return { state, effects: [] }
      }
      return {
        state: {
          ...initialPollingState,
          status: 'polling',
          messageId: action.messageId,
          executionId: action.executionId ?? null,
          branchId: action.branchId,
        },
        effects: [{ type: 'SCHEDULE_POLL' }],
      }
    }

    case 'POLL_STARTED': {
      if (state.pollInFlight) {
        return { state, effects: [] }
      }
      return {
        state: { ...state, pollInFlight: true },
        effects: [],
      }
    }

    case 'POLL_FINISHED': {
      return {
        state: { ...state, pollInFlight: false },
        effects: [],
      }
    }

    case 'POLL_NOT_FOUND': {
      const newRetries = state.notFoundRetries + 1
      if (newRetries >= MAX_NOT_FOUND_RETRIES) {
        return {
          state: {
            ...state,
            status: 'error',
            notFoundRetries: newRetries,
            pollInFlight: false,
          },
          effects: [
            { type: 'CANCEL_POLL' },
            { type: 'APPEND_STOPPED_NOTE' },
            { type: 'SET_BRANCH_IDLE', unread: false },
          ],
        }
      }
      return {
        state: { ...state, notFoundRetries: newRetries, pollInFlight: false },
        effects: [],
      }
    }

    case 'POLL_ERROR': {
      return {
        state: { ...state, pollInFlight: false },
        effects: [],
      }
    }

    case 'POLL_RESPONSE': {
      const { response } = action

      // Reset not-found counter on successful response
      let newState: PollingState = { ...state, notFoundRetries: 0 }

      // Handle unexpected status (not running, completed, or error)
      if (
        response.status != null &&
        response.status !== 'running' &&
        response.status !== 'completed' &&
        response.status !== 'error'
      ) {
        return {
          state: {
            ...newState,
            status: 'stopped',
            pollInFlight: false,
          },
          effects: [
            { type: 'CANCEL_POLL' },
            { type: 'APPEND_STOPPED_NOTE' },
            { type: 'SET_BRANCH_IDLE', unread: false },
            { type: 'CLEAR_STREAMING_REF', messageId: state.messageId!, delayMs: 0 },
          ],
        }
      }

      const effects: PollingEffect[] = []

      // Process content updates
      const hasContent = response.content ||
        (response.toolCalls && response.toolCalls.length > 0) ||
        (response.contentBlocks && response.contentBlocks.length > 0)

      if (hasContent) {
        const toolCallsWithIds = addToolCallIds(response.toolCalls || [])
        const contentBlocksWithIds = addContentBlockIds(response.contentBlocks || [])
        effects.push({
          type: 'UPDATE_MESSAGE',
          content: response.content || '',
          toolCalls: toolCallsWithIds,
          contentBlocks: contentBlocksWithIds,
        })
      }

      // Handle completion
      if (response.status === 'completed' || response.status === 'error') {
        // Only handle completion once
        if (state.completionHandled) {
          return { state: { ...newState, pollInFlight: false }, effects: [] }
        }

        newState = {
          ...newState,
          status: response.status === 'completed' ? 'completed' : 'error',
          completionHandled: true,
          pollInFlight: false,
        }

        effects.push({ type: 'CANCEL_POLL' })

        if (response.status === 'error') {
          effects.push({
            type: 'APPEND_ERROR',
            error: response.error || '',
            agentCrashed: response.agentCrashed,
          })
        }

        effects.push({ type: 'FORCE_SAVE' })
        effects.push({ type: 'DETECT_COMMITS', runAutoCommit: true })
        effects.push({ type: 'CLEAR_STREAMING_REF', messageId: state.messageId!, delayMs: 2000 })

        return { state: newState, effects }
      }

      return { state: { ...newState, pollInFlight: false }, effects }
    }

    case 'STOP': {
      if (state.status !== 'polling') {
        return { state, effects: [] }
      }
      return {
        state: {
          ...state,
          status: 'stopped',
          pollInFlight: false,
        },
        effects: [
          { type: 'CANCEL_POLL' },
          { type: 'DETECT_COMMITS', runAutoCommit: true },
          { type: 'SET_BRANCH_IDLE', unread: false },
          { type: 'CLEAR_STREAMING_REF', messageId: state.messageId!, delayMs: 0 },
        ],
      }
    }

    case 'RESET': {
      return {
        state: initialPollingState,
        effects: [{ type: 'CANCEL_POLL' }],
      }
    }

    default:
      return { state, effects: [] }
  }
}

// =============================================================================
// Pure Helper Functions
// =============================================================================

/**
 * Determines if polling should continue based on response status.
 */
export function shouldContinuePolling(status: string): boolean {
  return status === 'running'
}

/**
 * Determines if we've exceeded retry limits.
 */
export function hasExceededRetryLimit(retries: number, maxRetries: number = MAX_NOT_FOUND_RETRIES): boolean {
  return retries >= maxRetries
}

/**
 * Adds stable IDs to tool calls for React rendering.
 * Uses index-based IDs (could be improved with content hashing).
 */
export function addToolCallIds(toolCalls: ToolCall[]): ToolCallWithId[] {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return toolCalls.map((tc, idx) => ({
    id: `tc-${idx}`,
    tool: tc.tool,
    summary: tc.summary,
    fullSummary: tc.fullSummary,
    filePath: tc.filePath,
    output: tc.output,
    timestamp,
  }))
}

/**
 * Adds stable IDs to content blocks for React rendering.
 */
export function addContentBlockIds(contentBlocks: ContentBlock[]): ContentBlockWithId[] {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return contentBlocks.map((block, blockIdx): ContentBlockWithId => {
    if (block.type === 'tool_calls' && block.toolCalls) {
      return {
        type: 'tool_calls' as const,
        toolCalls: block.toolCalls.map((tc, tcIdx) => ({
          id: `tc-${blockIdx}-${tcIdx}`,
          tool: tc.tool,
          summary: tc.summary,
          fullSummary: tc.fullSummary,
          filePath: tc.filePath,
          output: tc.output,
          timestamp,
        })),
      }
    }
    return {
      type: block.type,
      text: block.text,
    }
  })
}

/**
 * Builds error content string from error response.
 */
export function buildErrorContent(
  existingContent: string,
  error?: string,
  agentCrashed?: { message?: string; output?: string }
): string {
  let content = existingContent

  if (agentCrashed) {
    const crashMsg = agentCrashed.message ?? 'Process exited without completing'
    content = content ? `${content}\n\n[Agent crashed: ${crashMsg}]` : `[Agent crashed: ${crashMsg}]`
    if (agentCrashed.output) {
      content += `\n\nOutput:\n${agentCrashed.output}`
    }
  } else if (error) {
    const runFailed = `Run failed: ${error}`
    content = content ? `${content}\n\n${runFailed}` : runFailed
  }

  return content
}
