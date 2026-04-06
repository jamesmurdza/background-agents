import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode" | "codex" | "gemini" | "goose"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini" | "goose"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
  "codex": "codex",
  "gemini": "gemini",
  "goose": "goose",
}

// Helper to get provider from agent string (handles legacy "claude" value)
// Note: For opencode agent, we always use the "opencode" provider with model IDs
// in the format "opencode/model-name" (e.g., "opencode/big-pickle", "opencode/claude-sonnet-4").
export function getProviderForAgent(agent: string | undefined): ProviderName {
  if (!agent || agent === "claude" || agent === "claude-code") {
    return "claude"
  }
  if (agent === "opencode") {
    return "opencode"
  }
  if (agent === "codex") {
    return "codex"
  }
  if (agent === "gemini") {
    return "gemini"
  }
  if (agent === "goose") {
    return "goose"
  }
  // Fallback for any other value
  return "claude"
}

// Model configurations per agent
export interface ModelOption {
  value: string
  label: string
  requiresKey?: "anthropic" | "openai" | "opencode" | "gemini" | "none" // Which API key is required
}

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "default", label: "Default", requiresKey: "anthropic" },
    { value: "sonnet", label: "Sonnet", requiresKey: "anthropic" },
    { value: "opus", label: "Opus", requiresKey: "anthropic" },
    { value: "haiku", label: "Haiku", requiresKey: "anthropic" },
  ],
  "opencode": [
    // Free models (opencode/) - no API key needed
    { value: "opencode/big-pickle", label: "Big Pickle (Free)", requiresKey: "none" },
    { value: "opencode/nemotron-3-super-free", label: "Nemotron 3 Super (Free)", requiresKey: "none" },
    { value: "opencode/minimax-m2.5-free", label: "MiniMax M2.5 (Free)", requiresKey: "none" },
    { value: "opencode/mimo-v2-flash-free", label: "MiMo v2 Flash (Free)", requiresKey: "none" },
    // Paid opencode/ models (requires OpenCode API key)
    { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "opencode" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "opencode" },
    { value: "opencode/gpt-5", label: "GPT-5", requiresKey: "opencode" },
    { value: "opencode/gpt-5-codex", label: "GPT-5 Codex", requiresKey: "opencode" },
    { value: "opencode/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "opencode" },
    { value: "opencode/gemini-3-flash", label: "Gemini 3 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3-pro", label: "Gemini 3 Pro", requiresKey: "opencode" },
    { value: "opencode/kimi-k2.5", label: "Kimi K2.5", requiresKey: "opencode" },
    // Anthropic direct models (requires Anthropic API key, not subscription)
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "anthropic" },
    // OpenAI direct models (requires OpenAI API key)
    { value: "openai/codex-mini-latest", label: "Codex Mini Latest", requiresKey: "openai" },
    { value: "openai/gpt-3.5-turbo", label: "GPT-3.5 Turbo", requiresKey: "openai" },
    { value: "openai/gpt-4", label: "GPT-4", requiresKey: "openai" },
    { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "openai/gpt-4.1", label: "GPT-4.1", requiresKey: "openai" },
    { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", requiresKey: "openai" },
    { value: "openai/gpt-4.1-nano", label: "GPT-4.1 Nano", requiresKey: "openai" },
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4o-2024-05-13", label: "GPT-4o 2024-05-13", requiresKey: "openai" },
    { value: "openai/gpt-4o-2024-08-06", label: "GPT-4o 2024-08-06", requiresKey: "openai" },
    { value: "openai/gpt-4o-2024-11-20", label: "GPT-4o 2024-11-20", requiresKey: "openai" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/gpt-5", label: "GPT-5", requiresKey: "openai" },
    { value: "openai/gpt-5-codex", label: "GPT-5 Codex", requiresKey: "openai" },
    { value: "openai/gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "openai" },
    { value: "openai/gpt-5-pro", label: "GPT-5 Pro", requiresKey: "openai" },
    { value: "openai/gpt-5.1", label: "GPT-5.1", requiresKey: "openai" },
    { value: "openai/gpt-5.1-chat-latest", label: "GPT-5.1 Chat Latest", requiresKey: "openai" },
    { value: "openai/gpt-5.1-codex", label: "GPT-5.1 Codex", requiresKey: "openai" },
    { value: "openai/gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", requiresKey: "openai" },
    { value: "openai/gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", requiresKey: "openai" },
    { value: "openai/gpt-5.2", label: "GPT-5.2", requiresKey: "openai" },
    { value: "openai/gpt-5.2-chat-latest", label: "GPT-5.2 Chat Latest", requiresKey: "openai" },
    { value: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex", requiresKey: "openai" },
    { value: "openai/gpt-5.2-pro", label: "GPT-5.2 Pro", requiresKey: "openai" },
    { value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "openai" },
    { value: "openai/gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", requiresKey: "openai" },
    { value: "openai/gpt-5.4", label: "GPT-5.4", requiresKey: "openai" },
    { value: "openai/gpt-5.4-pro", label: "GPT-5.4 Pro", requiresKey: "openai" },
    { value: "openai/o1", label: "o1", requiresKey: "openai" },
    { value: "openai/o1-mini", label: "o1 Mini", requiresKey: "openai" },
    { value: "openai/o1-preview", label: "o1 Preview", requiresKey: "openai" },
    { value: "openai/o1-pro", label: "o1 Pro", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-deep-research", label: "o3 Deep Research", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/o3-pro", label: "o3 Pro", requiresKey: "openai" },
    { value: "openai/o4-mini", label: "o4 Mini", requiresKey: "openai" },
    { value: "openai/o4-mini-deep-research", label: "o4 Mini Deep Research", requiresKey: "openai" },
  ],
  "codex": [
    // Recommended models
    { value: "gpt-5.4", label: "GPT-5.4 (Recommended)", requiresKey: "openai" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "openai" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", requiresKey: "openai" },
    // Alternative models
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", requiresKey: "openai" },
    { value: "gpt-5.2", label: "GPT-5.2", requiresKey: "openai" },
    { value: "gpt-5.1", label: "GPT-5.1", requiresKey: "openai" },
  ],
  "gemini": [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Recommended)", requiresKey: "gemini" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "gemini" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", requiresKey: "gemini" },
  ],
  "goose": [
    { value: "gpt-4o", label: "GPT-4o (Recommended)", requiresKey: "openai" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
  ],
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  // Use a free OpenCode-hosted model that doesn't require any API key
  "opencode": "opencode/big-pickle",
  "codex": "gpt-5.4",
  "gemini": "gemini-2.5-flash",
  "goose": "gpt-4o",
}

// User credentials for filtering
export interface UserCredentialFlags {
  hasAnthropicApiKey?: boolean
  hasAnthropicAuthToken?: boolean
  hasOpenaiApiKey?: boolean
  hasOpencodeApiKey?: boolean
  hasGeminiApiKey?: boolean
  /** Server has OpenRouter (or similar) so AI branch naming works without user API keys */
  hasServerLlmFallback?: boolean
  squashOnMerge?: boolean
  prDescriptionMode?: string
}

/**
 * Get the default agent based on user credentials.
 * If user has Anthropic credentials (API key or subscription), default to Claude Code.
 * Otherwise, default to OpenCode (which has free models).
 */
export function getDefaultAgent(credentials: UserCredentialFlags | null | undefined): Agent {
  if (credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken) {
    return "claude-code"
  }
  return "opencode"
}

/**
 * Check if user has credentials for Claude Code agent.
 */
export function hasClaudeCodeCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!(credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken)
}

/**
 * Check if user has credentials for Codex agent (requires OpenAI API key).
 */
export function hasCodexCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!credentials?.hasOpenaiApiKey
}

/**
 * Check if user has credentials for Gemini agent (requires Gemini API key).
 */
export function hasGeminiCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!credentials?.hasGeminiApiKey
}

/**
 * Check if user has credentials for Goose agent (requires OpenAI or Anthropic API key).
 */
export function hasGooseCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!(credentials?.hasOpenaiApiKey || credentials?.hasAnthropicApiKey)
}

/**
 * Get all models for an agent (no filtering by credentials).
 * All models are shown in the UI regardless of API key availability.
 */
export function getAvailableModels(
  agent: Agent,
  _credentials: UserCredentialFlags | null | undefined
): ModelOption[] {
  return agentModels[agent] ?? []
}

/**
 * Check if user has credentials for a specific model.
 * Returns true if the model can be used, false if credentials are missing.
 *
 * Note: For OpenCode agent, paid models require an OpenCode API key.
 * Claude Code agent can use either Anthropic API key or subscription.
 */
export function hasCredentialsForModel(
  model: ModelOption,
  credentials: UserCredentialFlags | null | undefined,
  agent?: Agent
): boolean {
  switch (model.requiresKey) {
    case "none":
      return true
    case "anthropic":
      // OpenCode agent requires API key only - Claude subscription doesn't work with it
      if (agent === "opencode") {
        return !!credentials?.hasAnthropicApiKey
      }
      // Claude Code agent can use either API key or subscription
      return !!(credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken)
    case "openai":
      return !!credentials?.hasOpenaiApiKey
    case "opencode":
      return !!credentials?.hasOpencodeApiKey
    case "gemini":
      return !!credentials?.hasGeminiApiKey
    default:
      return true
  }
}

/**
 * Get the default model for an agent based on available credentials.
 * Falls back to free models if no API keys are configured.
 */
export function getDefaultModelForAgent(
  agent: Agent,
  credentials: UserCredentialFlags | null | undefined
): string {
  const allModels = agentModels[agent] ?? []
  const defaultModel = defaultAgentModel[agent]

  // Find the default model config
  const defaultModelConfig = allModels.find(m => m.value === defaultModel)

  // If the default model can be used with current credentials, use it
  if (defaultModelConfig && hasCredentialsForModel(defaultModelConfig, credentials, agent)) {
    return defaultModel
  }

  // Otherwise, find the first model that can be used
  const firstAvailable = allModels.find(m => hasCredentialsForModel(m, credentials, agent))
  return firstAvailable?.value || defaultModel
}

export interface ToolCall {
  id: string
  tool: string // "Read", "Edit", "Write", "Glob", "Grep", "Bash", etc.
  summary: string
  fullSummary?: string // Full summary when truncated (for hover tooltip)
  filePath?: string // Full file path for file-related tools (Read, Edit, Write)
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
  commitHash?: string
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

// AnthropicAuthType is exported from constants.ts

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "gemini": "Gemini",
  "goose": "Goose",
}

// Get model label from model value
export function getModelLabel(agent: Agent, modelValue: string | undefined): string {
  if (!modelValue) {
    modelValue = defaultAgentModel[agent]
  }
  const models = agentModels[agent] ?? []
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}
