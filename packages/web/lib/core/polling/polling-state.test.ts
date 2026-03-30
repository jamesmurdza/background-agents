import { describe, it, expect } from 'vitest'
import {
  pollingReducer,
  initialPollingState,
  shouldContinuePolling,
  hasExceededRetryLimit,
  addToolCallIds,
  addContentBlockIds,
  shouldContinueLoop,
  buildErrorContent,
  MAX_NOT_FOUND_RETRIES,
  type PollingState,
  type StatusResponse,
} from './polling-state'

describe('pollingReducer', () => {
  describe('START action', () => {
    it('transitions from idle to polling', () => {
      const { state, effects } = pollingReducer(initialPollingState, {
        type: 'START',
        messageId: 'msg-1',
        branchId: 'branch-1',
      })

      expect(state.status).toBe('polling')
      expect(state.messageId).toBe('msg-1')
      expect(state.branchId).toBe('branch-1')
      expect(effects).toContainEqual({ type: 'SCHEDULE_POLL' })
    })

    it('ignores START when already polling (prevents race condition)', () => {
      const pollingState: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-existing',
        branchId: 'branch-existing',
      }

      const { state, effects } = pollingReducer(pollingState, {
        type: 'START',
        messageId: 'msg-new',
        branchId: 'branch-new',
      })

      expect(state.status).toBe('polling')
      expect(state.messageId).toBe('msg-existing') // Unchanged
      expect(effects).toHaveLength(0) // No effects
    })

    it('stores executionId when provided', () => {
      const { state } = pollingReducer(initialPollingState, {
        type: 'START',
        messageId: 'msg-1',
        executionId: 'exec-1',
        branchId: 'branch-1',
      })

      expect(state.executionId).toBe('exec-1')
    })

    it('resets state on new polling session', () => {
      const errorState: PollingState = {
        ...initialPollingState,
        status: 'error',
        notFoundRetries: 5,
        completionHandled: true,
      }

      const { state } = pollingReducer(errorState, {
        type: 'START',
        messageId: 'msg-1',
        branchId: 'branch-1',
      })

      expect(state.notFoundRetries).toBe(0)
      expect(state.completionHandled).toBe(false)
    })
  })

  describe('POLL_STARTED action', () => {
    it('sets pollInFlight to true', () => {
      const { state } = pollingReducer(
        { ...initialPollingState, status: 'polling' },
        { type: 'POLL_STARTED' }
      )

      expect(state.pollInFlight).toBe(true)
    })

    it('ignores if already in flight (prevents concurrent polls)', () => {
      const inFlightState: PollingState = {
        ...initialPollingState,
        status: 'polling',
        pollInFlight: true,
      }

      const { state, effects } = pollingReducer(inFlightState, { type: 'POLL_STARTED' })

      expect(state.pollInFlight).toBe(true)
      expect(effects).toHaveLength(0)
    })
  })

  describe('POLL_NOT_FOUND action', () => {
    it('increments retry counter', () => {
      const { state } = pollingReducer(
        { ...initialPollingState, status: 'polling', notFoundRetries: 3 },
        { type: 'POLL_NOT_FOUND' }
      )

      expect(state.notFoundRetries).toBe(4)
    })

    it('transitions to error after max retries', () => {
      const almostMaxState: PollingState = {
        ...initialPollingState,
        status: 'polling',
        notFoundRetries: MAX_NOT_FOUND_RETRIES - 1,
        messageId: 'msg-1',
      }

      const { state, effects } = pollingReducer(almostMaxState, { type: 'POLL_NOT_FOUND' })

      expect(state.status).toBe('error')
      expect(state.notFoundRetries).toBe(MAX_NOT_FOUND_RETRIES)
      expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
      expect(effects).toContainEqual({ type: 'APPEND_STOPPED_NOTE' })
      expect(effects).toContainEqual({ type: 'SET_BRANCH_IDLE', unread: false })
    })
  })

  describe('POLL_RESPONSE action', () => {
    it('resets not-found counter on successful response', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        notFoundRetries: 5,
        messageId: 'msg-1',
      }

      const response: StatusResponse = { status: 'running', content: 'Working...' }
      const { state: newState } = pollingReducer(state, { type: 'POLL_RESPONSE', response })

      expect(newState.notFoundRetries).toBe(0)
    })

    it('emits UPDATE_MESSAGE for content updates', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
      }

      const response: StatusResponse = {
        status: 'running',
        content: 'Processing...',
        toolCalls: [{ tool: 'bash', summary: 'Running tests' }],
      }

      const { effects } = pollingReducer(state, { type: 'POLL_RESPONSE', response })

      const updateEffect = effects.find((e) => e.type === 'UPDATE_MESSAGE')
      expect(updateEffect).toBeDefined()
      expect(updateEffect?.type === 'UPDATE_MESSAGE' && updateEffect.content).toBe('Processing...')
    })

    it('handles completion status', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
      }

      const response: StatusResponse = { status: 'completed', content: 'Done!' }
      const { state: newState, effects } = pollingReducer(state, { type: 'POLL_RESPONSE', response })

      expect(newState.status).toBe('completed')
      expect(newState.completionHandled).toBe(true)
      expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
      expect(effects).toContainEqual({ type: 'FORCE_SAVE' })
      expect(effects).toContainEqual({ type: 'DETECT_COMMITS', runAutoCommit: true })
    })

    it('only handles completion once (prevents race condition)', () => {
      const alreadyHandledState: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
        completionHandled: true,
      }

      const response: StatusResponse = { status: 'completed', content: 'Done!' }
      const { state, effects } = pollingReducer(alreadyHandledState, {
        type: 'POLL_RESPONSE',
        response,
      })

      // Should not transition or emit effects
      expect(state.status).toBe('polling')
      expect(effects).toHaveLength(0)
    })

    it('handles error status with crash info', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
      }

      const response: StatusResponse = {
        status: 'error',
        content: 'Failed',
        error: 'Timeout',
        agentCrashed: { message: 'OOM killed', output: 'stack trace...' },
      }

      const { state: newState, effects } = pollingReducer(state, {
        type: 'POLL_RESPONSE',
        response,
      })

      expect(newState.status).toBe('error')
      const appendError = effects.find((e) => e.type === 'APPEND_ERROR')
      expect(appendError).toBeDefined()
      expect(appendError?.type === 'APPEND_ERROR' && appendError.agentCrashed?.message).toBe('OOM killed')
    })

    it('handles unexpected status by stopping', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
      }

      const response: StatusResponse = { status: 'unknown_status' }
      const { state: newState, effects } = pollingReducer(state, {
        type: 'POLL_RESPONSE',
        response,
      })

      expect(newState.status).toBe('stopped')
      expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
      expect(effects).toContainEqual({ type: 'APPEND_STOPPED_NOTE' })
    })
  })

  describe('STOP action', () => {
    it('stops polling and triggers commit detection', () => {
      const state: PollingState = {
        ...initialPollingState,
        status: 'polling',
        messageId: 'msg-1',
      }

      const { state: newState, effects } = pollingReducer(state, { type: 'STOP' })

      expect(newState.status).toBe('stopped')
      expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
      expect(effects).toContainEqual({ type: 'DETECT_COMMITS', runAutoCommit: true })
      expect(effects).toContainEqual({ type: 'SET_BRANCH_IDLE', unread: false })
    })

    it('ignores STOP when not polling', () => {
      const { state, effects } = pollingReducer(initialPollingState, { type: 'STOP' })

      expect(state.status).toBe('idle')
      expect(effects).toHaveLength(0)
    })
  })

  describe('RESET action', () => {
    it('resets to initial state', () => {
      const activeState: PollingState = {
        status: 'polling',
        messageId: 'msg-1',
        executionId: 'exec-1',
        branchId: 'branch-1',
        notFoundRetries: 5,
        completionHandled: true,
        pollInFlight: true,
      }

      const { state, effects } = pollingReducer(activeState, { type: 'RESET' })

      expect(state).toEqual(initialPollingState)
      expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
    })
  })
})

describe('helper functions', () => {
  describe('shouldContinuePolling', () => {
    it('returns true for running status', () => {
      expect(shouldContinuePolling('running')).toBe(true)
    })

    it('returns false for completed status', () => {
      expect(shouldContinuePolling('completed')).toBe(false)
    })

    it('returns false for error status', () => {
      expect(shouldContinuePolling('error')).toBe(false)
    })
  })

  describe('hasExceededRetryLimit', () => {
    it('returns false when under limit', () => {
      expect(hasExceededRetryLimit(5, 10)).toBe(false)
    })

    it('returns true when at limit', () => {
      expect(hasExceededRetryLimit(10, 10)).toBe(true)
    })

    it('returns true when over limit', () => {
      expect(hasExceededRetryLimit(15, 10)).toBe(true)
    })

    it('uses default MAX_NOT_FOUND_RETRIES', () => {
      expect(hasExceededRetryLimit(MAX_NOT_FOUND_RETRIES)).toBe(true)
      expect(hasExceededRetryLimit(MAX_NOT_FOUND_RETRIES - 1)).toBe(false)
    })
  })

  describe('addToolCallIds', () => {
    it('adds IDs and timestamps to tool calls', () => {
      const toolCalls = [
        { tool: 'bash', summary: 'Running tests' },
        { tool: 'edit', summary: 'Modifying file' },
      ]

      const result = addToolCallIds(toolCalls)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('tc-0')
      expect(result[1].id).toBe('tc-1')
      expect(result[0].timestamp).toBeDefined()
    })

    it('preserves fullSummary', () => {
      const toolCalls = [
        { tool: 'bash', summary: 'short', fullSummary: 'Full summary here' },
      ]

      const result = addToolCallIds(toolCalls)

      expect(result[0].fullSummary).toBe('Full summary here')
    })
  })

  describe('addContentBlockIds', () => {
    it('adds IDs to tool_calls blocks', () => {
      const blocks = [
        {
          type: 'tool_calls',
          toolCalls: [
            { tool: 'bash', summary: 'test' },
            { tool: 'edit', summary: 'edit' },
          ],
        },
      ]

      const result = addContentBlockIds(blocks)

      expect(result[0].type).toBe('tool_calls')
      expect(result[0].toolCalls?.[0].id).toBe('tc-0-0')
      expect(result[0].toolCalls?.[1].id).toBe('tc-0-1')
    })

    it('passes through non-tool_calls blocks unchanged', () => {
      const blocks = [{ type: 'text', text: 'Hello world' }]

      const result = addContentBlockIds(blocks)

      expect(result[0]).toEqual(blocks[0])
    })
  })

  describe('shouldContinueLoop', () => {
    const mockIsLoopFinished = (content: string) => content.includes('[LOOP_FINISHED]')

    it('returns true when loop should continue', () => {
      expect(
        shouldContinueLoop('completed', true, 2, 10, 'Still working...', mockIsLoopFinished)
      ).toBe(true)
    })

    it('returns false when loop is disabled', () => {
      expect(
        shouldContinueLoop('completed', false, 2, 10, 'Working...', mockIsLoopFinished)
      ).toBe(false)
    })

    it('returns false when max iterations reached', () => {
      expect(
        shouldContinueLoop('completed', true, 10, 10, 'Working...', mockIsLoopFinished)
      ).toBe(false)
    })

    it('returns false when content indicates loop finished', () => {
      expect(
        shouldContinueLoop('completed', true, 2, 10, '[LOOP_FINISHED] Done!', mockIsLoopFinished)
      ).toBe(false)
    })

    it('returns false on error status', () => {
      expect(
        shouldContinueLoop('error', true, 2, 10, 'Working...', mockIsLoopFinished)
      ).toBe(false)
    })
  })

  describe('buildErrorContent', () => {
    it('appends crash message', () => {
      const result = buildErrorContent('Existing content', undefined, {
        message: 'OOM killed',
      })

      expect(result).toBe('Existing content\n\n[Agent crashed: OOM killed]')
    })

    it('includes crash output when provided', () => {
      const result = buildErrorContent('', undefined, {
        message: 'Timeout',
        output: 'stack trace here',
      })

      expect(result).toContain('[Agent crashed: Timeout]')
      expect(result).toContain('Output:\nstack trace here')
    })

    it('uses default crash message when not provided', () => {
      const result = buildErrorContent('', undefined, {})

      expect(result).toContain('[Agent crashed: Process exited without completing]')
    })

    it('appends error message when no crash', () => {
      const result = buildErrorContent('Working...', 'Connection timeout')

      expect(result).toBe('Working...\n\nRun failed: Connection timeout')
    })

    it('handles empty existing content', () => {
      const result = buildErrorContent('', 'Error message')

      expect(result).toBe('Run failed: Error message')
    })
  })
})
