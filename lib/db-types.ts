/**
 * Types for database models as returned by API endpoints
 * These are the "raw" shapes before transformation to frontend types
 */

import type { Message, Branch } from "@/lib/types"

export interface DbSandbox {
  id: string
  sandboxId: string
  contextId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  status: string
}

export interface DbMessage {
  id: string
  role: string
  content: string
  toolCalls: unknown
  contentBlocks: unknown
  timestamp: string | null
  commitHash: string | null
  commitMessage: string | null
}

/**
 * Summary version of DbMessage - returned when ?summary=true
 * Used for lazy loading to reduce network transfer
 */
export interface DbMessageSummary {
  id: string
  role: string
  createdAt: string
  timestamp: string | null
  commitHash: string | null
  commitMessage: string | null
}

export interface DbBranch {
  id: string
  name: string
  baseBranch: string | null
  startCommit: string | null
  status: string
  prUrl: string | null
  draftPrompt: string | null
  agent: string | null
  model: string | null
  // Loop mode fields
  loopEnabled: boolean
  loopCount: number
  loopMaxIterations: number
  // Commit tracking
  lastShownCommitHash: string | null
  sandbox: DbSandbox | null
  messages?: DbMessage[]
}

export interface DbRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: DbBranch[]
}

export interface Quota {
  current: number
  max: number
  remaining: number
}

export interface UserCredentials {
  anthropicAuthType: string
  hasAnthropicApiKey: boolean
  hasAnthropicAuthToken: boolean
  hasOpenaiApiKey: boolean
  hasOpencodeApiKey: boolean
  hasDaytonaApiKey: boolean
  sandboxAutoStopInterval?: number
  defaultLoopMaxIterations?: number
}

/**
 * Transform a database message to frontend format
 */
export function transformMessage(m: DbMessage): Message {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    toolCalls: m.toolCalls as Message["toolCalls"],
    contentBlocks: m.contentBlocks as Message["contentBlocks"],
    timestamp: m.timestamp || "",
    commitHash: m.commitHash || undefined,
    commitMessage: m.commitMessage || undefined,
  }
}

/**
 * Transform a summary message to frontend format
 * Sets contentLoaded=false to indicate full content needs to be fetched
 */
export function transformMessageSummary(m: DbMessageSummary): Message {
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: "", // Not loaded yet
    timestamp: m.timestamp || "",
    commitHash: m.commitHash || undefined,
    commitMessage: m.commitMessage || undefined,
    contentLoaded: false, // Flag to indicate content needs lazy loading
  }
}

/**
 * Transform a database branch to frontend format
 */
export function transformBranch(dbBranch: DbBranch): Branch {
  return {
    id: dbBranch.id,
    name: dbBranch.name,
    baseBranch: dbBranch.baseBranch || "main",
    startCommit: dbBranch.startCommit || undefined,
    status: dbBranch.status as Branch["status"],
    prUrl: dbBranch.prUrl || undefined,
    draftPrompt: dbBranch.draftPrompt || undefined,
    agent: (dbBranch.agent || "claude-code") as Branch["agent"],
    model: dbBranch.model || undefined,
    // Loop mode fields
    loopEnabled: dbBranch.loopEnabled ?? false,
    loopCount: dbBranch.loopCount ?? 0,
    loopMaxIterations: dbBranch.loopMaxIterations ?? 10,
    // Commit tracking
    lastShownCommitHash: dbBranch.lastShownCommitHash || undefined,
    sandboxId: dbBranch.sandbox?.sandboxId,
    contextId: dbBranch.sandbox?.contextId || undefined,
    sessionId: dbBranch.sandbox?.sessionId || undefined,
    previewUrlPattern: dbBranch.sandbox?.previewUrlPattern || undefined,
    messages: (dbBranch.messages || []).map(transformMessage),
  }
}

/**
 * Transform a database repo to frontend format
 */
export function transformRepo(dbRepo: DbRepo) {
  return {
    id: dbRepo.id,
    name: dbRepo.name,
    owner: dbRepo.owner,
    avatar: dbRepo.avatar || "",
    defaultBranch: dbRepo.defaultBranch,
    branches: (dbRepo.branches || []).map(transformBranch),
  }
}

export type TransformedRepo = ReturnType<typeof transformRepo>
