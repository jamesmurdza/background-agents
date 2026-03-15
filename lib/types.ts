import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini" | "openai" | "anthropic"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
}

// Helper to get provider from agent string (handles legacy "claude" value)
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

/**
 * Determines the SDK provider based on the model string.
 * Models prefixed with "openai/" should use the "openai" provider directly.
 * Models prefixed with "anthropic/" should use the "anthropic" provider directly.
 * OpenCode models (opencode/...) that are Claude-based should use "anthropic" provider.
 * OpenCode models that are GPT-based should use "openai" provider.
 * Otherwise, use the agent's default provider.
 */
export function getProviderForModel(model: string | undefined, agent: Agent | undefined): ProviderName {
  if (!model) {
    return getProviderForAgent(agent)
  }

  const [prefix, modelName] = model.split("/")

  // Direct provider prefixes
  if (prefix === "openai") {
    return "openai" as ProviderName
  }
  if (prefix === "anthropic") {
    return "anthropic" as ProviderName
  }

  // OpenCode models - determine provider by model name
  if (prefix === "opencode") {
    const nameLower = modelName?.toLowerCase() || ""

    // Claude family models -> anthropic provider
    if (nameLower.includes("claude") || nameLower.includes("sonnet") ||
        nameLower.includes("opus") || nameLower.includes("haiku")) {
      return "anthropic" as ProviderName
    }

    // GPT/Codex models -> openai provider
    if (nameLower.includes("gpt") || nameLower.includes("codex") || nameLower.startsWith("o3")) {
      return "openai" as ProviderName
    }

    // Free models and others -> opencode provider
    return "opencode"
  }

  // Fallback to agent's provider
  return getProviderForAgent(agent)
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
    { value: "opencode/big-pickle", label: "Big Pickle (Free)", requiresKey: "none" },
    { value: "opencode/minimax-m2.5-free", label: "MiniMax M2.5 (Free)", requiresKey: "none" },
    { value: "opencode/mimo-v2-flash-free", label: "MiMo v2 Flash (Free)", requiresKey: "none" },
    { value: "opencode/nemotron-3-super-free", label: "Nemotron 3 Super (Free)", requiresKey: "none" },
    // Anthropic models (requires Anthropic API key)
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4", requiresKey: "anthropic" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    // OpenAI models via OpenCode (requires OpenAI API key)
    { value: "opencode/gpt-5.4-pro", label: "GPT-5.4 Pro", requiresKey: "openai" },
    { value: "opencode/gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "openai" },
    { value: "opencode/gpt-5.1-codex", label: "GPT-5.1 Codex", requiresKey: "openai" },
    { value: "opencode/gpt-5", label: "GPT-5", requiresKey: "openai" },
    // OpenAI direct models (requires OpenAI API key)
    { value: "openai/gpt-5.2-chat-latest", label: "GPT-5.2 Chat", requiresKey: "openai" },
    { value: "openai/gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", requiresKey: "openai" },
  ],
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  "opencode": "opencode/big-pickle",
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
 * Filter models based on available API keys.
 * Returns only models the user can actually use.
 */
export function getAvailableModels(
  agent: Agent,
  credentials: UserCredentialFlags | null | undefined
): ModelOption[] {
  const allModels = agentModels[agent]

  return allModels.filter(model => {
    switch (model.requiresKey) {
      case "none":
        return true // Free models always available
      case "anthropic":
        return credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken
      case "openai":
        return credentials?.hasOpenaiApiKey
      default:
        return true // No requirement specified, show by default
    }
  })
}

/**
 * Get the default model for an agent based on available credentials.
 * Falls back to free models if no API keys are configured.
 */
export function getDefaultModelForAgent(
  agent: Agent,
  credentials: UserCredentialFlags | null | undefined
): string {
  const availableModels = getAvailableModels(agent, credentials)

  // If the default model is available, use it
  const defaultModel = defaultAgentModel[agent]
  if (availableModels.some(m => m.value === defaultModel)) {
    return defaultModel
  }

  // Otherwise, return the first available model
  return availableModels[0]?.value || defaultModel
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
