import { describe, it, expect } from 'vitest'
import {
  isLocalRicher,
  convertApiMessage,
  mergeMessages,
  shouldSkipSync,
  hasNewMessages,
  type MessageLike,
  type ApiMessage,
} from './message-merge'

describe('isLocalRicher', () => {
  it('returns true when local has more content', () => {
    const local: MessageLike = { id: '1', content: 'This is a longer message' }
    const api = { content: 'Short' }

    expect(isLocalRicher(local, api)).toBe(true)
  })

  it('returns true when local has more tool calls', () => {
    const local: MessageLike = {
      id: '1',
      content: 'Same',
      toolCalls: [{}, {}, {}],
    }
    const api = { content: 'Same', toolCalls: [{}] }

    expect(isLocalRicher(local, api)).toBe(true)
  })

  it('returns true when local has more content blocks', () => {
    const local: MessageLike = {
      id: '1',
      content: '',
      contentBlocks: [{}, {}],
    }
    const api = { content: '', contentBlocks: [{}] }

    expect(isLocalRicher(local, api)).toBe(true)
  })

  it('returns false when api has more content', () => {
    const local: MessageLike = { id: '1', content: 'Short' }
    const api = { content: 'This is a longer message from the API' }

    expect(isLocalRicher(local, api)).toBe(false)
  })

  it('returns false when content is equal', () => {
    const local: MessageLike = { id: '1', content: 'Same content' }
    const api = { content: 'Same content' }

    expect(isLocalRicher(local, api)).toBe(false)
  })

  it('handles undefined content gracefully', () => {
    const local: MessageLike = { id: '1' }
    const api = { content: 'Has content' }

    expect(isLocalRicher(local, api)).toBe(false)
  })

  it('handles undefined arrays gracefully', () => {
    const local: MessageLike = { id: '1', content: '' }
    const api = { content: '', toolCalls: [{}] }

    expect(isLocalRicher(local, api)).toBe(false)
  })
})

describe('convertApiMessage', () => {
  it('converts API message to local format', () => {
    const apiMessage: ApiMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Hello',
      toolCalls: [{ tool: 'bash', summary: 'test' }],
      contentBlocks: [],
      timestamp: '12:00',
      commitHash: 'abc123',
      commitMessage: 'Fix bug',
    }

    const result = convertApiMessage(apiMessage)

    expect(result.id).toBe('msg-1')
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toEqual([{ tool: 'bash', summary: 'test' }])
    expect(result.timestamp).toBe('12:00')
    expect(result.commitHash).toBe('abc123')
    expect(result.commitMessage).toBe('Fix bug')
  })

  it('handles null commitHash and commitMessage', () => {
    const apiMessage: ApiMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      commitHash: null,
      commitMessage: null,
    }

    const result = convertApiMessage(apiMessage)

    expect(result.commitHash).toBeUndefined()
    expect(result.commitMessage).toBeUndefined()
  })

  it('handles missing timestamp', () => {
    const apiMessage: ApiMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
    }

    const result = convertApiMessage(apiMessage)

    expect(result.timestamp).toBe('')
  })
})

describe('mergeMessages', () => {
  it('merges API messages with local messages', () => {
    const localMessages: MessageLike[] = [
      { id: 'msg-1', content: 'Hi', role: 'user' },
    ]
    const apiMessages: ApiMessage[] = [
      { id: 'msg-1', role: 'user', content: 'Hi there' },
      { id: 'msg-2', role: 'assistant', content: 'New from API' },
    ]

    const result = mergeMessages(localMessages, apiMessages)

    expect(result).toHaveLength(2)
    // msg-1: API has longer content, so API wins
    expect(result[0].id).toBe('msg-1')
    expect(result[0].content).toBe('Hi there')
    // msg-2: New from API
    expect(result[1].id).toBe('msg-2')
  })

  it('keeps richer local message over API message', () => {
    const localMessages: MessageLike[] = [
      {
        id: 'msg-1',
        content: 'This is a much longer streaming message with lots of content',
        role: 'assistant',
      },
    ]
    const apiMessages: ApiMessage[] = [
      { id: 'msg-1', role: 'assistant', content: 'Short' },
    ]

    const result = mergeMessages(localMessages, apiMessages)

    expect(result[0].content).toBe(
      'This is a much longer streaming message with lots of content'
    )
  })

  it('preserves optimistic messages not in API', () => {
    const localMessages: MessageLike[] = [
      { id: 'local-only', content: 'Optimistic message', role: 'user' },
    ]
    const apiMessages: ApiMessage[] = [
      { id: 'api-1', role: 'assistant', content: 'From API' },
    ]

    const result = mergeMessages(localMessages, apiMessages)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('api-1')
    expect(result[1].id).toBe('local-only')
  })

  it('handles empty local messages', () => {
    const apiMessages: ApiMessage[] = [
      { id: 'api-1', role: 'assistant', content: 'Hello' },
    ]

    const result = mergeMessages([], apiMessages)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('api-1')
  })

  it('handles empty API messages', () => {
    const localMessages: MessageLike[] = [
      { id: 'local-1', content: 'Hello', role: 'user' },
    ]

    const result = mergeMessages(localMessages, [])

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local-1')
  })

  it('preserves local with more tool calls even if content is same', () => {
    const localMessages: MessageLike[] = [
      {
        id: 'msg-1',
        content: 'Same',
        role: 'assistant',
        toolCalls: [{}, {}, {}],
      },
    ]
    const apiMessages: ApiMessage[] = [
      { id: 'msg-1', role: 'assistant', content: 'Same', toolCalls: [{}] },
    ]

    const result = mergeMessages(localMessages, apiMessages)

    expect(result[0].toolCalls).toHaveLength(3)
  })
})

describe('shouldSkipSync', () => {
  it('returns false when not streaming', () => {
    expect(shouldSkipSync(null, 'branch-1', 'branch-1')).toBe(false)
  })

  it('returns false when streaming on different branch', () => {
    expect(shouldSkipSync('msg-1', 'branch-2', 'branch-1')).toBe(false)
  })

  it('returns true when streaming on active branch', () => {
    expect(shouldSkipSync('msg-1', 'branch-1', 'branch-1')).toBe(true)
  })

  it('returns false when activeBranchId is null', () => {
    expect(shouldSkipSync('msg-1', 'branch-1', null)).toBe(false)
  })
})

describe('hasNewMessages', () => {
  it('returns true when message ID changed', () => {
    expect(hasNewMessages('msg-1', 'msg-2')).toBe(true)
  })

  it('returns false when message ID is same', () => {
    expect(hasNewMessages('msg-1', 'msg-1')).toBe(false)
  })

  it('returns false when current is null', () => {
    expect(hasNewMessages('msg-1', null)).toBe(false)
  })

  it('returns true when previous was null and current has value', () => {
    expect(hasNewMessages(null, 'msg-1')).toBe(true)
  })

  it('returns false when both are null', () => {
    expect(hasNewMessages(null, null)).toBe(false)
  })
})
