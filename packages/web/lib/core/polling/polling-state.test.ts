import { describe, it, expect } from 'vitest'
import {
  pollingReducer,
  initialPollingState,
  buildErrorContent,
  addToolCallIds,
  addContentBlockIds,
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

describe('buildErrorContent', () => {
  it('appends crash info', () => {
    expect(buildErrorContent('', undefined, { message: 'OOM' })).toContain('[Agent crashed: OOM]')
  })

  it('appends error message', () => {
    expect(buildErrorContent('', 'timeout')).toBe('Run failed: timeout')
  })
})

describe('addToolCallIds', () => {
  it('adds id and timestamp to tool calls', () => {
    const toolCalls = [
      { tool: 'Read', summary: 'Read: file.ts' },
      { tool: 'Bash', summary: 'npm install' },
    ]
    const result = addToolCallIds(toolCalls)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('tc-0')
    expect(result[1].id).toBe('tc-1')
    expect(result[0].timestamp).toBeDefined()
  })

  it('preserves filePath property for file-related tools', () => {
    const toolCalls = [
      { tool: 'Read', summary: 'Read: file.ts', filePath: '/home/user/repo/file.ts' },
      { tool: 'Edit', summary: 'Edit: component.tsx', fullSummary: 'Edit: /home/user/repo/src/component.tsx', filePath: '/home/user/repo/src/component.tsx' },
      { tool: 'Bash', summary: 'npm install' },
    ]
    const result = addToolCallIds(toolCalls)

    expect(result[0].filePath).toBe('/home/user/repo/file.ts')
    expect(result[1].filePath).toBe('/home/user/repo/src/component.tsx')
    expect(result[1].fullSummary).toBe('Edit: /home/user/repo/src/component.tsx')
    expect(result[2].filePath).toBeUndefined()
  })
})

describe('addContentBlockIds', () => {
  it('adds ids to tool calls within content blocks', () => {
    const blocks = [
      { type: 'text' as const, text: 'Some text' },
      {
        type: 'tool_calls' as const,
        toolCalls: [
          { tool: 'Read', summary: 'Read: file.ts' },
        ]
      },
    ]
    const result = addContentBlockIds(blocks)

    expect(result[0].type).toBe('text')
    expect(result[0].text).toBe('Some text')
    expect(result[1].type).toBe('tool_calls')
    expect(result[1].toolCalls?.[0].id).toBe('tc-1-0')
  })

  it('preserves filePath property in tool calls within content blocks', () => {
    const blocks = [
      {
        type: 'tool_calls' as const,
        toolCalls: [
          { tool: 'Read', summary: 'Read: file.ts', filePath: '/home/user/repo/file.ts' },
          { tool: 'Write', summary: 'Write: new.ts', fullSummary: 'Write: /home/user/repo/new.ts', filePath: '/home/user/repo/new.ts' },
        ]
      },
    ]
    const result = addContentBlockIds(blocks)

    expect(result[0].toolCalls?.[0].filePath).toBe('/home/user/repo/file.ts')
    expect(result[0].toolCalls?.[1].filePath).toBe('/home/user/repo/new.ts')
    expect(result[0].toolCalls?.[1].fullSummary).toBe('Write: /home/user/repo/new.ts')
  })
})
