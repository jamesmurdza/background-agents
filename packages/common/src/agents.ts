/**
 * Agent configuration and metadata
 * Shared between web and simple-chat packages
 */

// =============================================================================
// Agent Types
// =============================================================================

export type Agent = "claude-code" | "opencode" | "codex" | "eliza" | "gemini" | "goose" | "pi"

/** All agent ids, in display order. */
export const ALL_AGENTS: Agent[] = ["claude-code", "opencode", "codex", "gemini", "goose", "pi", "eliza"]

/** SDK provider names (must match ProviderName from SDK) */
export type ProviderName = "claude" | "codex" | "eliza" | "opencode" | "gemini" | "goose" | "pi"

/** Display labels for each agent */
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "eliza": "Eliza",
  "gemini": "Gemini",
  "goose": "Goose",
  "pi": "Pi",
}

// =============================================================================
// Credentials
// =============================================================================

/** Provider an API key is associated with. */
export type ProviderId = "anthropic" | "openai" | "opencode" | "gemini"

/**
 * Credential identifiers. The id doubles as the env var name we inject
 * into the agent process, so the storage and runtime shapes are the same.
 */
export type CredentialId =
  | "ANTHROPIC_API_KEY"
  | "CLAUDE_CODE_CREDENTIALS"
  | "OPENAI_API_KEY"
  | "OPENCODE_API_KEY"
  | "GEMINI_API_KEY"

export type CredentialFlags = Partial<Record<CredentialId, boolean>> & {
  // Server has a shared Claude credential pool (e.g. the rotating row written
  // by simple-chat's /api/cron/refresh-claude-creds). Treated as a Claude Code
  // credential at the UI gate so the user can pick claude-code without pasting
  // their own token. Not a CredentialId — it's a server capability, not an env var.
  CLAUDE_SHARED_POOL_AVAILABLE?: boolean
}
export type Credentials = Partial<Record<CredentialId, string>>

/** Env vars to inject for a given provider. */
const PROVIDER_ENV: Record<ProviderId, CredentialId[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
}

// =============================================================================
// Model Configuration
// =============================================================================

export interface ModelOption {
  value: string
  label: string
  /** Which provider's API key is required for this model. "none" means no key needed. */
  requiresKey?: ProviderId | "none"
}

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "default", label: "Default", requiresKey: "anthropic" },
    { value: "sonnet", label: "Sonnet", requiresKey: "anthropic" },
    { value: "opus", label: "Opus", requiresKey: "anthropic" },
    { value: "haiku", label: "Haiku", requiresKey: "anthropic" },
  ],
  "eliza": [
    { value: "eliza-classic-1.0", label: "Eliza Classic", requiresKey: "none" },
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
    { value: "opencode/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "opencode" },
    { value: "opencode/gpt-5", label: "GPT-5", requiresKey: "opencode" },
    { value: "opencode/gpt-5-codex", label: "GPT-5 Codex", requiresKey: "opencode" },
    { value: "opencode/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "opencode" },
    { value: "opencode/gemini-3-flash", label: "Gemini 3 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.1-pro", label: "Gemini 3.1 Pro", requiresKey: "opencode" },
    { value: "opencode/kimi-k2.5", label: "Kimi K2.5", requiresKey: "opencode" },
    // Anthropic direct models (requires Anthropic API key)
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
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
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", requiresKey: "gemini" },
  ],
  "goose": [
    { value: "gpt-4o", label: "GPT-4o (Recommended)", requiresKey: "openai" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
  ],
  "pi": [
    // Anthropic models (default provider)
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Recommended)", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
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
  "eliza": "eliza-classic-1.0", // Fake agent, no API key needed
  "gemini": "gemini-2.5-flash",
  "goose": "gpt-4o",
  "pi": "claude-sonnet-4-5",
}

// =============================================================================
// Credential queries
// =============================================================================

/**
 * Get the default agent based on user credentials.
 * If user has Anthropic credentials, default to Claude Code.
 * Otherwise, default to OpenCode (which has free models).
 */
export function getDefaultAgent(flags: CredentialFlags | null | undefined): Agent {
  if (flags?.ANTHROPIC_API_KEY || flags?.CLAUDE_CODE_CREDENTIALS || flags?.CLAUDE_SHARED_POOL_AVAILABLE) {
    return "claude-code"
  }
  return "opencode"
}

/**
 * Check if user has credentials for a specific model.
 */
export function hasCredentialsForModel(
  model: ModelOption,
  flags: CredentialFlags | null | undefined,
  agent?: Agent
): boolean {
  if (!model.requiresKey || model.requiresKey === "none") return true
  if (model.requiresKey === "anthropic") {
    // OpenCode and Pi require an API key — they can't drive a subscription session.
    if (agent === "opencode" || agent === "pi") return !!flags?.ANTHROPIC_API_KEY
    // Claude Code can use either API key, the user's pasted subscription, or the shared pool.
    return !!(flags?.ANTHROPIC_API_KEY || flags?.CLAUDE_CODE_CREDENTIALS || flags?.CLAUDE_SHARED_POOL_AVAILABLE)
  }
  return PROVIDER_ENV[model.requiresKey].some((id) => flags?.[id])
}

/**
 * Get the default model for an agent based on available credentials.
 * Falls back to free models if no API keys are configured.
 */
export function getDefaultModelForAgent(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): string {
  const allModels = agentModels[agent] ?? []
  const defaultModel = defaultAgentModel[agent]

  const defaultModelConfig = allModels.find(m => m.value === defaultModel)
  if (defaultModelConfig && hasCredentialsForModel(defaultModelConfig, flags, agent)) {
    return defaultModel
  }

  const firstAvailable = allModels.find(m => hasCredentialsForModel(m, flags, agent))
  return firstAvailable?.value || defaultModel
}

/**
 * Pick env vars to inject for a given agent + model. The credentials map is
 * already keyed by env var name, so this is a relevance filter with two
 * special cases: claude-code prefers the subscription token over the API
 * key, and Gemini also exposes its key as GOOGLE_API_KEY for compatibility.
 */
export function getEnvForModel(
  model: string | undefined,
  agent: Agent | undefined,
  credentials: Credentials
): Record<string, string> {
  // Claude Code: subscription token wins over API key.
  if ((!agent || agent === "claude-code") && credentials.CLAUDE_CODE_CREDENTIALS) {
    return { CLAUDE_CODE_CREDENTIALS: credentials.CLAUDE_CODE_CREDENTIALS }
  }

  const opt = agent ? (agentModels[agent] ?? []).find((m) => m.value === model) : undefined
  if (!opt?.requiresKey || opt.requiresKey === "none") return {}

  const env: Record<string, string> = {}
  for (const id of PROVIDER_ENV[opt.requiresKey]) {
    const v = credentials[id]
    if (v) env[id] = v
  }
  if (env.GEMINI_API_KEY) env.GOOGLE_API_KEY = env.GEMINI_API_KEY
  return env
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
