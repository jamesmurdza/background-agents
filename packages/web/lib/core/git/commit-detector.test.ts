import { describe, it, expect, vi } from 'vitest'
import {
  getExistingCommitHashes,
  filterNewCommits,
  hasNewCommits,
  getMostRecentCommitHash,
  createCommitMessage,
  processCommitsForChat,
  type Commit,
  type Message,
} from './commit-detector'

describe('getExistingCommitHashes', () => {
  it('extracts commit hashes from messages', () => {
    const messages: Message[] = [
      { id: '1', content: 'Hello' },
      { id: '2', commitHash: 'abc123' },
      { id: '3', commitHash: 'def456' },
      { id: '4', content: 'World' },
    ]

    const result = getExistingCommitHashes(messages)

    expect(result.size).toBe(2)
    expect(result.has('abc123')).toBe(true)
    expect(result.has('def456')).toBe(true)
  })

  it('returns empty set when no commits', () => {
    const messages: Message[] = [
      { id: '1', content: 'Hello' },
      { id: '2', content: 'World' },
    ]

    const result = getExistingCommitHashes(messages)

    expect(result.size).toBe(0)
  })

  it('handles empty message list', () => {
    const result = getExistingCommitHashes([])

    expect(result.size).toBe(0)
  })
})

describe('filterNewCommits', () => {
  it('filters out commits already shown in chat', () => {
    const allCommits: Commit[] = [
      { shortHash: 'new1', message: 'New commit 1' },
      { shortHash: 'new2', message: 'New commit 2' },
      { shortHash: 'old1', message: 'Old commit 1' },
      { shortHash: 'old2', message: 'Old commit 2' },
    ]
    const existingHashes = new Set(['old1', 'old2'])

    const result = filterNewCommits(allCommits, existingHashes)

    expect(result).toHaveLength(2)
    expect(result[0].shortHash).toBe('new2') // Reversed for chronological order
    expect(result[1].shortHash).toBe('new1')
  })

  it('returns all commits when none are in chat', () => {
    const allCommits: Commit[] = [
      { shortHash: 'abc', message: 'Commit A' },
      { shortHash: 'def', message: 'Commit B' },
    ]
    const existingHashes = new Set<string>()

    const result = filterNewCommits(allCommits, existingHashes)

    expect(result).toHaveLength(2)
    // Reversed: oldest first
    expect(result[0].shortHash).toBe('def')
    expect(result[1].shortHash).toBe('abc')
  })

  it('returns empty array when all commits are already shown', () => {
    const allCommits: Commit[] = [
      { shortHash: 'abc', message: 'Commit A' },
      { shortHash: 'def', message: 'Commit B' },
    ]
    const existingHashes = new Set(['abc', 'def'])

    const result = filterNewCommits(allCommits, existingHashes)

    expect(result).toHaveLength(0)
  })

  it('stops at first seen commit (avoids out-of-order)', () => {
    // Git log returns newest first: commit3, commit2, commit1
    // If commit2 is already in chat, we only show commit3
    const allCommits: Commit[] = [
      { shortHash: 'commit3', message: 'Newest' },
      { shortHash: 'commit2', message: 'Already shown' },
      { shortHash: 'commit1', message: 'Also shown' },
    ]
    const existingHashes = new Set(['commit2'])

    const result = filterNewCommits(allCommits, existingHashes)

    expect(result).toHaveLength(1)
    expect(result[0].shortHash).toBe('commit3')
  })

  it('handles empty commit list', () => {
    const result = filterNewCommits([], new Set(['abc']))

    expect(result).toHaveLength(0)
  })
})

describe('hasNewCommits', () => {
  it('returns true when there are new commits', () => {
    const allCommits: Commit[] = [
      { shortHash: 'new', message: 'New' },
      { shortHash: 'old', message: 'Old' },
    ]
    const existingHashes = new Set(['old'])

    expect(hasNewCommits(allCommits, existingHashes)).toBe(true)
  })

  it('returns false when no new commits', () => {
    const allCommits: Commit[] = [{ shortHash: 'old', message: 'Old' }]
    const existingHashes = new Set(['old'])

    expect(hasNewCommits(allCommits, existingHashes)).toBe(false)
  })

  it('returns false for empty commit list', () => {
    expect(hasNewCommits([], new Set())).toBe(false)
  })
})

describe('getMostRecentCommitHash', () => {
  it('returns first commit hash (newest)', () => {
    const commits: Commit[] = [
      { shortHash: 'newest', message: 'Newest' },
      { shortHash: 'older', message: 'Older' },
    ]

    expect(getMostRecentCommitHash(commits)).toBe('newest')
  })

  it('returns null for empty list', () => {
    expect(getMostRecentCommitHash([])).toBeNull()
  })
})

describe('createCommitMessage', () => {
  it('creates a commit message object', () => {
    const commit: Commit = { shortHash: 'abc123', message: 'Fix bug' }
    const generateId = vi.fn().mockReturnValue('msg-1')

    const result = createCommitMessage(commit, generateId)

    expect(result.id).toBe('msg-1')
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('')
    expect(result.commitHash).toBe('abc123')
    expect(result.commitMessage).toBe('Fix bug')
    expect(result.timestamp).toBeDefined()
    expect(generateId).toHaveBeenCalled()
  })
})

describe('processCommitsForChat', () => {
  it('processes commits and returns messages to add', () => {
    const allCommits: Commit[] = [
      { shortHash: 'new1', message: 'New feature' },
      { shortHash: 'new2', message: 'Bug fix' },
      { shortHash: 'old', message: 'Already shown' },
    ]
    const existingMessages: Message[] = [{ id: '1', commitHash: 'old' }]
    let idCounter = 0
    const generateId = () => `msg-${++idCounter}`

    const result = processCommitsForChat(allCommits, existingMessages, generateId)

    expect(result).toHaveLength(2)
    // Oldest first (reversed)
    expect(result[0].commitHash).toBe('new2')
    expect(result[1].commitHash).toBe('new1')
    expect(result[0].id).toBe('msg-1')
    expect(result[1].id).toBe('msg-2')
  })

  it('returns empty array when no new commits', () => {
    const allCommits: Commit[] = [{ shortHash: 'old', message: 'Old' }]
    const existingMessages: Message[] = [{ id: '1', commitHash: 'old' }]

    const result = processCommitsForChat(allCommits, existingMessages, () => 'id')

    expect(result).toHaveLength(0)
  })

  it('handles empty existing messages', () => {
    const allCommits: Commit[] = [
      { shortHash: 'abc', message: 'Commit' },
    ]
    const generateId = () => 'msg-1'

    const result = processCommitsForChat(allCommits, [], generateId)

    expect(result).toHaveLength(1)
    expect(result[0].commitHash).toBe('abc')
  })
})
