import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
}

// Helper to get provider from agent string (handles legacy "claude" value)
// Note: For opencode agent, we always use the "opencode" provider. The OpenCode CLI
// itself handles routing to different backends (OpenAI, Anthropic, OpenRouter) based
// on the model string format (e.g., "openai/gpt-4o", "anthropic/claude-sonnet-4").
export function getProviderForAgent(agent: string | undefined): ProviderName {
  if (!agent || agent === "claude" || agent === "claude-code") {
    return "claude"
  }
  if (agent === "opencode") {
    return "opencode"
  }
  // Fallback for any other value
  return "claude"
}

// Model configurations per agent
export interface ModelOption {
  value: string
  label: string
  requiresKey?: "anthropic" | "openai" | "none" // Which API key is required
}

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "default", label: "Default", requiresKey: "anthropic" },
    { value: "sonnet", label: "Sonnet", requiresKey: "anthropic" },
    { value: "opus", label: "Opus", requiresKey: "anthropic" },
    { value: "haiku", label: "Haiku", requiresKey: "anthropic" },
  ],
  "opencode": [
    // Free models (limited time) - no API key needed
    // These use openrouter/ prefix as they're served via OpenRouter's free tier
    { value: "openrouter/sao10k/l3.3-euryale-70b", label: "Big Pickle (Free)", requiresKey: "none" },
    { value: "openrouter/minimax/minimax-01", label: "MiniMax M2.5 (Free)", requiresKey: "none" },
    { value: "openrouter/xiaomi/mimo-vl-7b-free", label: "MiMo v2 Flash (Free)", requiresKey: "none" },
    { value: "openrouter/nvidia/llama-3.1-nemotron-ultra-253b-v1:free", label: "Nemotron 3 Super (Free)", requiresKey: "none" },
    // Anthropic models (requires Anthropic API key)
    // These use anthropic/ prefix as expected by OpenCode CLI
    { value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", requiresKey: "anthropic" },
    { value: "anthropic/claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", requiresKey: "anthropic" },
    { value: "anthropic/claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", requiresKey: "anthropic" },
    // OpenAI models (requires OpenAI API key)
    // These use openai/ prefix as expected by OpenCode CLI
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3-mini", requiresKey: "openai" },
    { value: "openai/gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
  ],
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  "opencode": "openrouter/sao10k/l3.3-euryale-70b",
}

// User credentials for filtering
export interface UserCredentialFlags {
  hasAnthropicApiKey?: boolean
  hasAnthropicAuthToken?: boolean
  hasOpenaiApiKey?: boolean
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
 * Get all models for an agent (no filtering by credentials).
 * All models are shown in the UI regardless of API key availability.
 */
export function getAvailableModels(
  agent: Agent,
  _credentials: UserCredentialFlags | null | undefined
): ModelOption[] {
  return agentModels[agent]
}

/**
 * Check if user has credentials for a specific model.
 * Returns true if the model can be used, false if credentials are missing.
 */
export function hasCredentialsForModel(
  model: ModelOption,
  credentials: UserCredentialFlags | null | undefined
): boolean {
  switch (model.requiresKey) {
    case "none":
      return true
    case "anthropic":
      return !!(credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken)
    case "openai":
      return !!credentials?.hasOpenaiApiKey
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
  const allModels = agentModels[agent]
  const defaultModel = defaultAgentModel[agent]

  // Find the default model config
  const defaultModelConfig = allModels.find(m => m.value === defaultModel)

  // If the default model can be used with current credentials, use it
  if (defaultModelConfig && hasCredentialsForModel(defaultModelConfig, credentials)) {
    return defaultModel
  }

  // Otherwise, find the first model that can be used
  const firstAvailable = allModels.find(m => hasCredentialsForModel(m, credentials))
  return firstAvailable?.value || defaultModel
}

export interface ToolCall {
  id: string
  tool: string // "Read", "Edit", "Write", "Glob", "Grep", "Bash", etc.
  summary: string
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

export interface Settings {
  githubPat: string
  anthropicApiKey: string
  anthropicAuthType: AnthropicAuthType
  anthropicAuthToken: string
  daytonaApiKey: string
}

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
}

// Get model label from model value
export function getModelLabel(agent: Agent, modelValue: string | undefined): string {
  if (!modelValue) {
    modelValue = defaultAgentModel[agent]
  }
  const models = agentModels[agent]
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}

export const defaultSettings: Settings = {
  githubPat: "",
  anthropicApiKey: "",
  anthropicAuthType: "api-key",
  anthropicAuthToken: "",
  daytonaApiKey: "",
}
