import { describe, it, expect } from 'vitest'
import {
  pollingReducer,
  initialPollingState,
  shouldContinueLoop,
  buildErrorContent,
  MAX_NOT_FOUND_RETRIES,
  type PollingState,
} from './polling-state'

describe('pollingReducer', () => {
  it('starts polling from idle', () => {
    const { state, effects } = pollingReducer(initialPollingState, {
      type: 'START',
      messageId: 'msg-1',
      branchId: 'branch-1',
    })
    expect(state.status).toBe('polling')
    expect(effects).toContainEqual({ type: 'SCHEDULE_POLL' })
  })

  it('ignores START when already polling', () => {
    const { state, effects } = pollingReducer(
      { ...initialPollingState, status: 'polling', messageId: 'existing' },
      { type: 'START', messageId: 'new', branchId: 'b' }
    )
    expect(state.messageId).toBe('existing')
    expect(effects).toHaveLength(0)
  })

  it('handles completion only once', () => {
    const state: PollingState = { ...initialPollingState, status: 'polling', messageId: 'msg-1' }
    const { state: s1 } = pollingReducer(state, { type: 'POLL_RESPONSE', response: { status: 'completed' } })
    expect(s1.completionHandled).toBe(true)

    const { effects } = pollingReducer(s1, { type: 'POLL_RESPONSE', response: { status: 'completed' } })
    expect(effects).toHaveLength(0)
  })

  it('errors after max retries', () => {
    const state: PollingState = { ...initialPollingState, status: 'polling', notFoundRetries: MAX_NOT_FOUND_RETRIES - 1 }
    const { state: newState, effects } = pollingReducer(state, { type: 'POLL_NOT_FOUND' })
    expect(newState.status).toBe('error')
    expect(effects).toContainEqual({ type: 'CANCEL_POLL' })
  })
})

describe('shouldContinueLoop', () => {
  const isFinished = (c: string) => c.includes('[DONE]')

  it('continues when conditions met', () => {
    expect(shouldContinueLoop('completed', true, 2, 10, 'working', isFinished)).toBe(true)
  })

  it('stops when disabled or max reached', () => {
    expect(shouldContinueLoop('completed', false, 2, 10, 'working', isFinished)).toBe(false)
    expect(shouldContinueLoop('completed', true, 10, 10, 'working', isFinished)).toBe(false)
  })
})

describe('buildErrorContent', () => {
  it('appends crash info', () => {
    expect(buildErrorContent('', undefined, { message: 'OOM' })).toContain('[Agent crashed: OOM]')
  })

  it('appends error message', () => {
    expect(buildErrorContent('', 'timeout')).toBe('Run failed: timeout')
  })
})
