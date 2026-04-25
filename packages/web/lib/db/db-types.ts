/**
 * Types for database models as returned by API endpoints
 * These are the "raw" shapes before transformation to frontend types
 */

import type { AssistantSource, Message, Branch } from "@/lib/shared/types"

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
  assistantSource?: string | null
  pushError?: unknown
  executeError?: unknown
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
  assistantSource?: string | null
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
  // Commit tracking
  lastShownCommitHash: string | null
  // Timestamps
  updatedAt: string
  sandbox: DbSandbox | null
  messages?: DbMessage[]
}

export interface DbRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  preferredBaseBranch: string | null
  branches: DbBranch[]
}

export interface Quota {
  current: number
  max: number
  remaining: number
}

export interface UserCredentials {
  anthropicAuthType: string
  ANTHROPIC_API_KEY?: boolean
  CLAUDE_CODE_CREDENTIALS?: boolean
  OPENAI_API_KEY?: boolean
  OPENCODE_API_KEY?: boolean
  GEMINI_API_KEY?: boolean
  hasDaytonaApiKey: boolean
  sandboxAutoStopInterval?: number
  squashOnMerge?: boolean
  prDescriptionMode?: string
}

function resolveAssistantSource(m: DbMessage): AssistantSource | undefined {
  if (m.role !== "assistant") return undefined
  const raw = m.assistantSource
  if (raw === "system" || raw === "commit" || raw === "model") return raw
  if (m.commitHash) return "commit"
  return "model"
}

/**
 * Transform a database message to frontend format
 */
export function transformMessage(m: DbMessage): Message {
  const assistantSource = resolveAssistantSource(m)
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    toolCalls: m.toolCalls as Message["toolCalls"],
    contentBlocks: m.contentBlocks as Message["contentBlocks"],
    timestamp: m.timestamp || "",
    commitHash: m.commitHash || undefined,
    commitMessage: m.commitMessage || undefined,
    ...(m.pushError != null && {
      pushError: m.pushError as Message["pushError"],
    }),
    ...(m.executeError != null && {
      executeError: m.executeError as Message["executeError"],
    }),
    ...(assistantSource != null && { assistantSource }),
  }
}

/**
 * Transform a summary message to frontend format
 * Sets contentLoaded=false to indicate full content needs to be fetched
 */
export function transformMessageSummary(m: DbMessageSummary): Message {
  const assistantSource =
    m.role === "assistant"
      ? m.assistantSource === "system" || m.assistantSource === "commit" || m.assistantSource === "model"
        ? m.assistantSource
        : m.commitHash
          ? ("commit" as const)
          : ("model" as const)
      : undefined
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: "", // Not loaded yet
    timestamp: m.timestamp || "",
    commitHash: m.commitHash || undefined,
    commitMessage: m.commitMessage || undefined,
    contentLoaded: false, // Flag to indicate content needs lazy loading
    ...(assistantSource != null && { assistantSource }),
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
    // Commit tracking
    lastShownCommitHash: dbBranch.lastShownCommitHash || undefined,
    // Activity timestamp for sorting (uses DB updatedAt)
    lastActivityTs: dbBranch.updatedAt ? new Date(dbBranch.updatedAt).getTime() : undefined,
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
    preferredBaseBranch: dbRepo.preferredBaseBranch || null,
    branches: (dbRepo.branches || []).map(transformBranch),
  }
}

export type TransformedRepo = ReturnType<typeof transformRepo>
