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
export type { Agent, ModelOption, UserCredentialFlags } from "@upstream/common"
export {
  agentModels,
  agentLabels,
  defaultAgentModel,
  getDefaultAgent,
  getDefaultModelForAgent,
  getModelLabel,
  hasCredentialsForModel,
} from "@upstream/common"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  /** Tool calls made by the assistant */
  toolCalls?: Array<{
    tool: string
    summary: string
    fullSummary?: string
    output?: string
  }>
  /** Ordered content blocks (text and tool calls interleaved) */
  contentBlocks?: ContentBlock[]
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
  previewUrlPattern?: string    // URL pattern for dev server previews

  // Agent config (per-chat, can be changed)
  agent?: string        // "claude-code" | "opencode" | "codex" | etc.
  model?: string        // Model ID for the agent

  // Chat data
  messages: Message[]
  createdAt: number
  updatedAt: number

  // Display name (auto-generated from first prompt)
  displayName: string | null

  // Status
  status: ChatStatus
}

export type ChatStatus = "pending" | "creating" | "ready" | "running" | "error"

export type Theme = "light" | "dark" | "system"

export interface Settings {
  // API keys for various providers
  anthropicApiKey: string
  openaiApiKey: string
  opencodeApiKey: string
  geminiApiKey: string

  // Default agent/model selection
  defaultAgent: string
  defaultModel: string

  // UI preferences
  theme: Theme
}

export interface AppState {
  currentChatId: string | null
  chats: Chat[]
  settings: Settings
}

// Re-export GitHub types from common
export type { GitHubRepo, GitHubBranch, GitHubUser } from "@upstream/common"

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
