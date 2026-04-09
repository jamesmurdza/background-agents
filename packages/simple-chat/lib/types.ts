/**
 * Types for Simple Chat
 */

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
  anthropicApiKey: string
  theme: Theme
}

export interface AppState {
  currentChatId: string | null
  chats: Chat[]
  settings: Settings
}

// GitHub types
export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
  }
  default_branch: string
  private: boolean
}

export interface GitHubBranch {
  name: string
  protected: boolean
}

export interface GitHubUser {
  login: string
  name: string | null
  avatar_url: string
  email: string | null
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
}

export interface ExecuteAgentResponse {
  success: boolean
}

export interface AgentStatusResponse {
  status: "running" | "completed" | "error"
  content: string
  toolCalls: Array<{
    tool: string
    summary: string
    fullSummary?: string
    output?: string
  }>
  error?: string
}

// Content block types (matching SDK)
export type ContentBlock = {
  type: "text"
  text: string
} | {
  type: "tool_calls"
  toolCalls: Array<{ tool: string; summary: string; fullSummary?: string; output?: string }>
}
