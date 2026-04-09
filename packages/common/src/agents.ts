/**
 * Agent configuration and metadata
 * Shared between web and simple-chat packages
 */

// =============================================================================
// Agent Types
// =============================================================================

export type Agent = "claude-code" | "opencode" | "codex" | "gemini" | "goose" | "pi"

/** SDK provider names (must match ProviderName from SDK) */
export type ProviderName = "claude" | "codex" | "opencode" | "gemini" | "goose" | "pi"

/** Map agent type to SDK provider name */
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
  "codex": "codex",
  "gemini": "gemini",
  "goose": "goose",
  "pi": "pi",
}

/** Display labels for each agent */
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "gemini": "Gemini",
  "goose": "Goose",
  "pi": "Pi",
}

/**
 * Get provider name from agent string (handles legacy "claude" value)
 */
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
  if (agent === "pi") {
    return "pi"
  }
  // Fallback for any other value
  return "claude"
}

// =============================================================================
// Model Configuration
// =============================================================================

export interface ModelOption {
  value: string
  label: string
  /** Which API key is required for this model */
  requiresKey?: "anthropic" | "openai" | "opencode" | "gemini" | "pi" | "none"
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
    // Anthropic direct models (requires Anthropic API key)
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
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/gpt-5", label: "GPT-5", requiresKey: "openai" },
    { value: "openai/gpt-5-codex", label: "GPT-5 Codex", requiresKey: "openai" },
    { value: "openai/gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "openai" },
    { value: "openai/gpt-5-pro", label: "GPT-5 Pro", requiresKey: "openai" },
    { value: "openai/gpt-5.1", label: "GPT-5.1", requiresKey: "openai" },
    { value: "openai/gpt-5.2", label: "GPT-5.2", requiresKey: "openai" },
    { value: "openai/o1", label: "o1", requiresKey: "openai" },
    { value: "openai/o1-mini", label: "o1 Mini", requiresKey: "openai" },
    { value: "openai/o1-pro", label: "o1 Pro", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/o3-pro", label: "o3 Pro", requiresKey: "openai" },
    { value: "openai/o4-mini", label: "o4 Mini", requiresKey: "openai" },
  ],
  "codex": [
    { value: "gpt-5.4", label: "GPT-5.4 (Recommended)", requiresKey: "openai" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "openai" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", requiresKey: "openai" },
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
  "pi": [
    // Anthropic models (default provider)
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    // OpenAI models
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5", label: "GPT-5", requiresKey: "openai" },
    // Google models
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "gemini" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini" },
  ],
}

/** Default model per agent */
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  "opencode": "opencode/big-pickle", // Free model, no API key needed
  "codex": "gpt-5.4",
  "gemini": "gemini-2.5-flash",
  "goose": "gpt-4o",
  "pi": "claude-sonnet-4-5",
}

// =============================================================================
// Credentials
// =============================================================================

export interface UserCredentialFlags {
  hasAnthropicApiKey?: boolean
  hasAnthropicAuthToken?: boolean
  hasOpenaiApiKey?: boolean
  hasOpencodeApiKey?: boolean
  hasGeminiApiKey?: boolean
  /** Server has OpenRouter (or similar) so AI branch naming works without user API keys */
  hasServerLlmFallback?: boolean
  // Web-specific settings (not used by simple-chat)
  squashOnMerge?: boolean
  prDescriptionMode?: string
}

/**
 * Get the default agent based on user credentials.
 * If user has Anthropic credentials, default to Claude Code.
 * Otherwise, default to OpenCode (which has free models).
 */
export function getDefaultAgent(credentials: UserCredentialFlags | null | undefined): Agent {
  if (credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken) {
    return "claude-code"
  }
  return "opencode"
}

/** Check if user has credentials for Claude Code agent */
export function hasClaudeCodeCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!(credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken)
}

/** Check if user has credentials for Codex agent */
export function hasCodexCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!credentials?.hasOpenaiApiKey
}

/** Check if user has credentials for Gemini agent */
export function hasGeminiCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!credentials?.hasGeminiApiKey
}

/** Check if user has credentials for Goose agent */
export function hasGooseCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!(credentials?.hasOpenaiApiKey || credentials?.hasAnthropicApiKey)
}

/** Check if user has credentials for Pi agent */
export function hasPiCredentials(credentials: UserCredentialFlags | null | undefined): boolean {
  return !!(credentials?.hasAnthropicApiKey || credentials?.hasOpenaiApiKey || credentials?.hasGeminiApiKey)
}

/**
 * Check if user has credentials for a specific model.
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
      // OpenCode and Pi agents require API key only
      if (agent === "opencode" || agent === "pi") {
        return !!credentials?.hasAnthropicApiKey
      }
      // Claude Code can use either API key or subscription
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

  const defaultModelConfig = allModels.find(m => m.value === defaultModel)

  if (defaultModelConfig && hasCredentialsForModel(defaultModelConfig, credentials, agent)) {
    return defaultModel
  }

  const firstAvailable = allModels.find(m => hasCredentialsForModel(m, credentials, agent))
  return firstAvailable?.value || defaultModel
}

/**
 * Get model label from model value
 */
export function getModelLabel(agent: Agent, modelValue: string | undefined): string {
  if (!modelValue) {
    modelValue = defaultAgentModel[agent]
  }
  const models = agentModels[agent] ?? []
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}
