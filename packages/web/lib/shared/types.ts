/**
 * Web application types
 *
 * Agent-related types are imported from @upstream/common and re-exported
 * for backward compatibility. Web-specific types are defined here.
 */

import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

// =============================================================================
// Re-export agent types from @upstream/common
// =============================================================================

export type {
  Agent,
  ProviderName,
  ModelOption,
  CredentialId,
  CredentialFlags,
  Credentials,
} from "@upstream/common"

export {
  agentToProvider,
  agentModels,
  agentLabels,
  defaultAgentModel,
  getProviderForAgent,
  getDefaultAgent,
  hasClaudeCodeCredentials,
  hasCodexCredentials,
  hasElizaCredentials,
  hasGeminiCredentials,
  hasGooseCredentials,
  hasPiCredentials,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
} from "@upstream/common"

import type { Agent, ModelOption, CredentialFlags } from "@upstream/common"
import { agentModels } from "@upstream/common"

/**
 * Web's user credential flags: env-var-keyed credential booleans plus a few
 * web-only fields (Daytona key, sandbox prefs, git/PR preferences) that ride
 * on the same /api/user/me response.
 */
export interface UserCredentialFlags extends CredentialFlags {
  anthropicAuthType?: string | null
  hasDaytonaApiKey?: boolean
  sandboxAutoStopInterval?: number
  /** Server has OpenRouter (or similar) so AI branch naming works without user API keys */
  hasServerLlmFallback?: boolean
  squashOnMerge?: boolean
  prDescriptionMode?: string
}

// =============================================================================
// Web-specific functions (extend common functionality)
// =============================================================================

/**
 * Get all models for an agent (no filtering by credentials).
 * All models are shown in the UI regardless of API key availability.
 */
export function getAvailableModels(
  agent: Agent,
  _flags: CredentialFlags | null | undefined
): ModelOption[] {
  return agentModels[agent] ?? []
}

// =============================================================================
// Content Block Types (re-export from common + web-specific extensions)
// =============================================================================

// Note: @upstream/common has simpler ContentBlock and ToolCall types.
// Web uses extended versions with additional fields (id, timestamp, etc.)

export interface ToolCall {
  id: string
  tool: string // "Read", "Edit", "Write", "Glob", "Grep", "Bash", etc.
  summary: string
  fullSummary?: string // Full summary when truncated (for hover tooltip)
  filePath?: string // Full file path for file-related tools (Read, Edit, Write)
  /** stdout/stderr captured from the command; only present when the agent emits it */
  output?: string
  timestamp: string
}

// Content block types for interleaved rendering
export interface TextContentBlock {
  type: "text"
  text: string
}

export interface ToolCallContentBlock {
  type: "tool_calls"
  toolCalls: ToolCall[]
}

export type ContentBlock = TextContentBlock | ToolCallContentBlock

// =============================================================================
// Web-specific Types
// =============================================================================

export interface PushErrorInfo {
  errorMessage: string
  branchName: string
  sandboxId: string
  repoPath: string
  repoOwner: string
  repoApiName: string
}

/** Failed to start agent run; shown as notice + retry (not as a model markdown bubble). */
export interface ExecuteErrorInfo {
  errorMessage: string
  prompt: string
}

/** Provenance for assistant rows (not user messages). */
export type AssistantSource = "model" | "system" | "commit"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  contentBlocks?: ContentBlock[]  // Interleaved text and tool calls in order
  timestamp: string
  commitHash?: string      // Short hash (7 chars) for display
  commitFullHash?: string  // Full hash (40 chars) for git operations like branching
  commitMessage?: string
  contentLoaded?: boolean  // false = summary only (content not loaded), true/undefined = full content available
  pushError?: PushErrorInfo  // Present when push failed, allows retry with branch deletion
  /** Failed POST /api/agent/execute; retry resends the same prompt to the same assistant row */
  executeError?: ExecuteErrorInfo
  /** Only for assistant: real model turn vs app/git vs commit chip. Omitted/undefined treated as model (except commit rows infer from commitHash). */
  assistantSource?: AssistantSource
}

export interface Branch {
  id: string
  name: string
  agent?: Agent
  model?: string
  messages: Message[]
  status: BranchStatus
  lastActivity?: string
  lastActivityTs?: number
  unread?: boolean
  sandboxId?: string
  contextId?: string
  sessionId?: string
  baseBranch: string
  startCommit?: string
  prUrl?: string
  previewUrlPattern?: string
  draftPrompt?: string
  // Commit tracking - HEAD at start of last execution, used for detecting new commits
  lastShownCommitHash?: string
  // Branch naming - tracks if user has manually renamed the branch
  hasCustomName?: boolean
  // Sync flag - set when remote is updated (e.g., merge into this branch) and sandbox needs to pull
  needsSync?: boolean
}

export interface Repo {
  id: string
  name: string
  owner: string
  avatar: string
  defaultBranch: string
  preferredBaseBranch: string | null
  branches: Branch[]
}
