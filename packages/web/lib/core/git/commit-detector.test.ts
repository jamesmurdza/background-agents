import { describe, it, expect } from 'vitest'
import {
  getExistingCommitHashes,
  filterNewCommits,
  type Commit,
  type Message,
} from './commit-detector'

describe('getExistingCommitHashes', () => {
  it('extracts commit hashes from messages', () => {
    const messages: Message[] = [
      { id: '1' },
      { id: '2', commitHash: 'abc123' },
      { id: '3', commitHash: 'def456' },
    ]
    const result = getExistingCommitHashes(messages)
    expect(result.size).toBe(2)
    expect(result.has('abc123')).toBe(true)
  })
})

describe('filterNewCommits', () => {
  it('filters out already-shown commits', () => {
    const commits: Commit[] = [
      { shortHash: 'new1', message: 'New' },
      { shortHash: 'old1', message: 'Old' },
    ]
    const result = filterNewCommits(commits, new Set(['old1']))
    expect(result).toHaveLength(1)
    expect(result[0].shortHash).toBe('new1')
  })

  it('stops at first seen commit', () => {
    const commits: Commit[] = [
      { shortHash: 'c3', message: 'Newest' },
      { shortHash: 'c2', message: 'Seen' },
      { shortHash: 'c1', message: 'Oldest' },
    ]
    const result = filterNewCommits(commits, new Set(['c2']))
    expect(result).toHaveLength(1)
    expect(result[0].shortHash).toBe('c3')
  })
})
