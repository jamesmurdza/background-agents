/**
 * Types for Simple Chat
 * Re-exports shared types from @upstream/common
 */

// Re-export shared types
export type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "@upstream/common"

import type { ContentBlock } from "@upstream/common"

// Re-export agent types
export type { Agent, ModelOption } from "@upstream/common"
export {
  ALL_AGENTS,
  agentModels,
  agentLabels,
  defaultAgentModel,
  getDefaultAgent,
  getDefaultModelForAgent,
  getModelLabel,
  hasCredentialsForModel,
} from "@upstream/common"

/** Message type for distinguishing system messages from regular chat */
export type MessageType = "chat" | "git-operation"

/** Action types for git-operation messages */
export type MessageAction = "force-push" | "view-pr" | "view-branch"

/** Metadata for git-operation messages */
export interface MessageMetadata {
  /** Action hint for rendering clickable links */
  action?: MessageAction
  /** PR URL for view-pr action */
  prUrl?: string
  /** PR number for view-pr action */
  prNumber?: number
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  /** Which agent produced this message */
  agent?: string
  /** Which model produced this message */
  model?: string
  /** Type of message - defaults to "chat" for regular messages */
  messageType?: MessageType
  /** For git-operation messages, whether this is an error */
  isError?: boolean
  /** Tool calls made by the assistant */
  toolCalls?: Array<{
    tool: string
    summary: string
    fullSummary?: string
    output?: string
  }>
  /** Ordered content blocks (text and tool calls interleaved) */
  contentBlocks?: ContentBlock[]
  /** Files uploaded with this message (for user messages) */
  uploadedFiles?: string[]
  /** For git-operation merge messages: the branch the link should point at on GitHub. */
  linkBranch?: string
  /** Flexible metadata for actions, links, etc. */
  metadata?: MessageMetadata
}

// Special value for new repository (local git repo, no GitHub)
export const NEW_REPOSITORY = "__new__"

export interface Chat {
  id: string

  // Repo config (set when chat created, IMMUTABLE after first message)
  repo: string           // "owner/repo" or NEW_REPOSITORY for local repo
  baseBranch: string     // "main" - what we branched FROM (ignored for NEW_REPOSITORY)

  // Created on first message
  branch: string | null         // "swift-lunar-abc1" - the NEW branch we created
  sandboxId: string | null      // Daytona sandbox ID
  sessionId: string | null      // Agent session ID for conversation continuity
  previewUrlPattern?: string    // URL pattern for dev server previews

  // Active execution (for recovery after page refresh)
  backgroundSessionId?: string  // Set when agent starts, cleared on completion

  // Agent config (per-chat, can be changed)
  agent?: string        // "claude-code" | "opencode" | "codex" | etc.
  model?: string        // Model ID for the agent

  // Chat data
  messages: Message[]
  /** Server-side message count (used when messages aren't loaded yet) */
  messageCount?: number
  createdAt: number
  updatedAt: number
  /** Timestamp of last activity: user message sent, agent content received, or agent completion. Used for sort order. */
  lastActiveAt?: number

  /** Messages queued while the agent was running. The next one is dispatched automatically on completion. */
  queuedMessages?: QueuedMessage[]
  /** When true, auto-dispatch of queued messages is suspended (e.g. user clicked Stop). Cleared when the user sends or queues again. */
  queuePaused?: boolean

  // Display name (auto-generated from first prompt)
  displayName: string | null

  /** When this chat was branched from another chat, the parent's id. */
  parentChatId?: string

  /** What's currently open in the preview pane for this chat, if anything.
   *  Persists across reloads but is scoped per chat so switching chats shows
   *  that chat's own preview (or hides the pane if it has none). */
  previewItem?:
    | { type: "file"; filePath: string; filename: string }
    | { type: "terminal"; id: string }
    | { type: "server"; port: number; url: string }

  // Status
  status: ChatStatus

  /** Last agent/streaming error message, surfaced when status === "error". Cleared on the next send. */
  errorMessage?: string

  /** Set when a merge targets this branch but sandbox was stopped. Triggers pull on next execute. */
  needsSync?: boolean

  /** Set if the last attempt to fetch this chat's messages from the server
   *  failed. Suppresses auto-retry on subsequent selects until the user
   *  explicitly retries. */
  messagesLoadFailed?: boolean
}

export type ChatStatus = "pending" | "creating" | "ready" | "running" | "error"

/** A message that the user submitted while the agent was busy. Files are not persisted. */
export interface QueuedMessage {
  id: string
  content: string
  agent?: string
  model?: string
}

export type Theme = "light" | "dark" | "system"

export interface Settings {
  // null means "no preference" — resolve via getDefaultAgent(flags) at the
  // call site. Lets the default track credential state (e.g. shared pool
  // available → claude-code) instead of a baked-in literal.
  defaultAgent: string | null
  defaultModel: string | null
  theme: Theme
}

export type { CredentialId, Credentials, CredentialFlags } from "./credentials"

import type { CredentialFlags } from "./credentials"

export interface AppState {
  currentChatId: string | null
  chats: Chat[]
  settings: Settings
  credentialFlags: CredentialFlags
}

// Re-export GitHub types from common
export type { GitHubRepo, GitHubBranch, GitHubUser } from "@upstream/common"

// File upload types
export interface PendingFile {
  id: string
  file: File
  name: string
  size: number
}

// API types
export interface CreateSandboxRequest {
  repo: string
  baseBranch: string
  newBranch: string
}

export interface CreateSandboxResponse {
  sandboxId: string
  previewUrlPattern?: string
}

export interface ExecuteAgentRequest {
  sandboxId: string
  prompt: string
  repoName: string
  agent?: string
  model?: string
}

export interface ExecuteAgentResponse {
  success: boolean
}

// =============================================================================
// SSE Event Types
// =============================================================================

export interface SSEUpdateEvent {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{
    tool: string
    summary: string
    fullSummary?: string
    output?: string
  }>
  contentBlocks: Array<
    | { type: "text"; text: string }
    | { type: "tool_calls"; toolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }> }
  >
  cursor: number
  sessionId?: string
  error?: string
}

export interface SSECompleteEvent {
  status: "completed" | "error"
  sessionId?: string
  error?: string
  cursor: number
}

export interface SSEHeartbeatEvent {
  cursor: number
  timestamp: number
}

export interface SSEErrorEvent {
  error: string
  cursor: number
}
