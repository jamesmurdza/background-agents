import {
  type BranchStatus,
  type AnthropicAuthType as ConstantsAnthropicAuthType,
  type AgentProvider,
  type CredentialType,
  AGENT_PROVIDER,
  CREDENTIAL_TYPE,
} from "./constants"

// Legacy type for backwards compatibility
export type Agent = "claude-code"

// New multi-agent types
export type ProviderName = AgentProvider

// Model configuration for each provider
export interface ModelConfig {
  id: string
  label: string
  provider: ProviderName
  requiresKey: CredentialType
}

// Agent configuration with available models
export interface AgentConfig {
  label: string
  description: string
  models: ModelConfig[]
  requiredCredentials: ("anthropicApiKey" | "anthropicAuthToken" | "openaiApiKey")[]
}

// Agent configurations for all supported providers
export const AGENT_CONFIGS: Record<ProviderName, AgentConfig> = {
  [AGENT_PROVIDER.CLAUDE]: {
    label: "Claude",
    description: "Anthropic's Claude coding agent",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Sonnet 4", provider: AGENT_PROVIDER.CLAUDE, requiresKey: CREDENTIAL_TYPE.ANTHROPIC },
      { id: "claude-opus-4-20250514", label: "Opus 4", provider: AGENT_PROVIDER.CLAUDE, requiresKey: CREDENTIAL_TYPE.ANTHROPIC },
    ],
    requiredCredentials: ["anthropicApiKey"],
  },
  [AGENT_PROVIDER.CODEX]: {
    label: "Codex",
    description: "OpenAI's Codex coding agent",
    models: [
      { id: "gpt-4o", label: "GPT-4o", provider: AGENT_PROVIDER.CODEX, requiresKey: CREDENTIAL_TYPE.OPENAI },
      { id: "o3", label: "o3", provider: AGENT_PROVIDER.CODEX, requiresKey: CREDENTIAL_TYPE.OPENAI },
      { id: "codex-mini-latest", label: "Codex Mini", provider: AGENT_PROVIDER.CODEX, requiresKey: CREDENTIAL_TYPE.OPENAI },
    ],
    requiredCredentials: ["openaiApiKey"],
  },
  [AGENT_PROVIDER.OPENCODE]: {
    label: "OpenCode",
    description: "Multi-provider coding agent with free model support",
    models: [
      { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: AGENT_PROVIDER.OPENCODE, requiresKey: CREDENTIAL_TYPE.ANTHROPIC },
      { id: "openai/gpt-4o", label: "GPT-4o", provider: AGENT_PROVIDER.OPENCODE, requiresKey: CREDENTIAL_TYPE.OPENAI },
      { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B (Free)", provider: AGENT_PROVIDER.OPENCODE, requiresKey: CREDENTIAL_TYPE.NONE },
      { id: "openrouter/deepseek/deepseek-r1", label: "DeepSeek R1 (Free)", provider: AGENT_PROVIDER.OPENCODE, requiresKey: CREDENTIAL_TYPE.NONE },
    ],
    requiredCredentials: [], // Can work with free models
  },
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
  agent: ProviderName
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
  openaiApiKey: string
  daytonaApiKey: string
}

// Legacy agent labels (for backwards compatibility)
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
}

// New provider labels
export const providerLabels: Record<ProviderName, string> = {
  [AGENT_PROVIDER.CLAUDE]: "Claude",
  [AGENT_PROVIDER.CODEX]: "Codex",
  [AGENT_PROVIDER.OPENCODE]: "OpenCode",
}

export const defaultSettings: Settings = {
  githubPat: "",
  anthropicApiKey: "",
  anthropicAuthType: "api-key",
  anthropicAuthToken: "",
  openaiApiKey: "",
  daytonaApiKey: "",
}

// Helper to get default model for a provider
export function getDefaultModel(provider: ProviderName): string {
  const config = AGENT_CONFIGS[provider]
  return config.models[0]?.id || ""
}

// Helper to check if credentials are available for a provider
export function hasRequiredCredentials(
  provider: ProviderName,
  credentials: {
    hasAnthropicApiKey?: boolean
    hasAnthropicAuthToken?: boolean
    hasOpenaiApiKey?: boolean
  }
): boolean {
  const config = AGENT_CONFIGS[provider]

  // OpenCode can work with free models, so always enabled
  if (provider === AGENT_PROVIDER.OPENCODE) {
    return true
  }

  // Check if any required credential is present
  for (const req of config.requiredCredentials) {
    if (req === "anthropicApiKey" && credentials.hasAnthropicApiKey) return true
    if (req === "anthropicAuthToken" && credentials.hasAnthropicAuthToken) return true
    if (req === "openaiApiKey" && credentials.hasOpenaiApiKey) return true
  }

  return config.requiredCredentials.length === 0
}
