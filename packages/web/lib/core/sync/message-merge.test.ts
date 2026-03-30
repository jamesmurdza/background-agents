import { describe, it, expect } from 'vitest'
import {
  isLocalRicher,
  mergeMessages,
  shouldSkipSync,
  type MessageLike,
  type ApiMessage,
} from './message-merge'

describe('isLocalRicher', () => {
  it('returns true when local has more content', () => {
    expect(isLocalRicher({ id: '1', content: 'longer' }, { content: 'short' })).toBe(true)
  })

  it('returns true when local has more tool calls', () => {
    expect(isLocalRicher({ id: '1', toolCalls: [{}, {}] }, { toolCalls: [{}] })).toBe(true)
  })

  it('returns false when equal or api is richer', () => {
    expect(isLocalRicher({ id: '1', content: 'same' }, { content: 'same' })).toBe(false)
  })

  it('returns true when local has pushError (same content as API)', () => {
    const pushError = { errorMessage: 'x', branchName: 'b', sandboxId: 's', repoPath: 'p', repoOwner: 'o', repoApiName: 'r' }
    expect(
      isLocalRicher(
        { id: '1', content: 'same', pushError },
        { content: 'same' }
      )
    ).toBe(true)
  })
})

describe('mergeMessages', () => {
  it('keeps richer local message', () => {
    const local: MessageLike[] = [{ id: '1', content: 'long streaming content' }]
    const api: ApiMessage[] = [{ id: '1', role: 'assistant', content: 'short' }]
    const result = mergeMessages(local, api)
    expect(result[0].content).toBe('long streaming content')
  })

  it('preserves optimistic messages', () => {
    const local: MessageLike[] = [{ id: 'local-only', content: 'pending' }]
    const api: ApiMessage[] = [{ id: 'api-1', role: 'user', content: 'from db' }]
    const result = mergeMessages(local, api)
    expect(result).toHaveLength(2)
  })

  it('keeps local pushError when API has same content', () => {
    const pushError = { errorMessage: 'Force push failed', branchName: 'b', sandboxId: 's', repoPath: 'p', repoOwner: 'o', repoApiName: 'r' }
    const local: MessageLike[] = [{ id: '1', role: 'assistant', content: '::icon-warning:: push failed', pushError }]
    const api: ApiMessage[] = [{ id: '1', role: 'assistant', content: '::icon-warning:: push failed' }]
    const result = mergeMessages(local, api)
    expect(result[0].pushError).toEqual(pushError)
  })

  it('preserves assistantSource from API', () => {
    const local: MessageLike[] = [{ id: '1', role: 'assistant', content: 'x' }]
    const api: ApiMessage[] = [{ id: '1', role: 'assistant', content: 'x', assistantSource: 'system' }]
    const result = mergeMessages(local, api)
    expect(result[0].assistantSource).toBe('system')
  })
})

describe('shouldSkipSync', () => {
  it('skips when streaming on active branch', () => {
    expect(shouldSkipSync('msg-1', 'branch-1', 'branch-1')).toBe(true)
    expect(shouldSkipSync(null, 'branch-1', 'branch-1')).toBe(false)
    expect(shouldSkipSync('msg-1', 'branch-2', 'branch-1')).toBe(false)
  })
})
