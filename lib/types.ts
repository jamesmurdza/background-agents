import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode" | "codex"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
  "codex": "codex",
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
  // Fallback for any other value
  return "claude"
}

// Model configurations per agent
export interface ModelOption {
  value: string
  label: string
  requiresKey?: "anthropic" | "openai" | "opencode" | "none" // Which API key is required
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
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  // Use a free OpenCode-hosted model that doesn't require any API key
  "opencode": "opencode/big-pickle",
  "codex": "gpt-5.4",
}

// User credentials for filtering
export interface UserCredentialFlags {
  hasAnthropicApiKey?: boolean
  hasAnthropicAuthToken?: boolean
  hasOpenaiApiKey?: boolean
  hasOpencodeApiKey?: boolean
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
  // Loop mode fields
  loopEnabled?: boolean
  loopCount?: number
  loopMaxIterations?: number
}

export interface Repo {
  id: string
  name: string
  owner: string
  avatar: string
  defaultBranch: string
  branches: Branch[]
}

export type AnthropicAuthType = ConstantsAnthropicAuthType

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
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

// Loop mode constants and helpers
export const LOOP_CONTINUATION_MESSAGE = "If you have finished all tasks, respond with just the phrase FINISHED. Otherwise, continue working on the remaining tasks."

export const DEFAULT_LOOP_MAX_ITERATIONS = 10
export const MAX_LOOP_ITERATIONS = 25

/**
 * Check if the agent response indicates completion (should stop looping).
 * Returns true if:
 * - The entire response (trimmed) is any case variation of "finished" (e.g., "finished", "FINISHED", "Finished")
 * - The response contains "FINISHED" (all caps) anywhere in the text
 */
export function isLoopFinished(content: string | null | undefined): boolean {
  if (!content) return false
  const trimmed = content.trim()

  // Check if entire response is any case variation of "finished"
  if (trimmed.toLowerCase() === "finished") {
    return true
  }

  // Check if response contains "FINISHED" (all caps) anywhere
  if (content.includes("FINISHED")) {
    return true
  }

  return false
}
