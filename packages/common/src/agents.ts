/**
 * Agent configuration and metadata
 * Shared between web and simple-chat packages
 */

// =============================================================================
// Agent Types
// =============================================================================

export type Agent = "claude-code" | "opencode" | "codex" | "copilot" | "eliza" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/** All agent ids, in display order. */
export const ALL_AGENTS: Agent[] = ["claude-code", "opencode", "codex", "copilot", "gemini", "goose", "kilo", "kimi", "pi", "eliza"]

/** SDK provider names (must match ProviderName from SDK) */
export type ProviderName = "claude" | "codex" | "copilot" | "eliza" | "opencode" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/** Display labels for each agent */
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "copilot": "GitHub Copilot",
  "eliza": "Eliza",
  "gemini": "Gemini",
  "goose": "Goose",
  "kilo": "Kilo",
  "kimi": "Kimi Code",
  "pi": "Pi",
}

/** Maps agent type to SDK provider name */
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
  "codex": "codex",
  "copilot": "copilot",
  "eliza": "eliza",
  "gemini": "gemini",
  "goose": "goose",
  "kilo": "kilo",
  "kimi": "kimi",
  "pi": "pi",
}

// =============================================================================
// Credentials
// =============================================================================

/** Provider an API key is associated with. */
export type ProviderId = "anthropic" | "github" | "openai" | "opencode" | "gemini" | "kilo" | "kimi"

/**
 * Credential identifiers. The id doubles as the env var name we inject
 * into the agent process, so the storage and runtime shapes are the same.
 */
export type CredentialId =
  | "ANTHROPIC_API_KEY"
  | "CLAUDE_CODE_CREDENTIALS"
  | "COPILOT_GITHUB_TOKEN"
  | "OPENAI_API_KEY"
  | "OPENCODE_API_KEY"
  | "GEMINI_API_KEY"
  | "KILO_API_KEY"
  | "KIMI_API_KEY"
  // Custom Anthropic-compatible endpoint ("Custom model" tab). Stored encrypted
  // like every other credential; mapped to the standard ANTHROPIC_* env vars at
  // injection time (see getEnvForModel / buildCustomModelEnv). Auth (API key or
  // bearer token) is supplied through CUSTOM_MODEL_HEADERS, not a dedicated field.
  | "CUSTOM_MODEL_BASE_URL"
  | "CUSTOM_MODEL_HEADERS"
  | "CUSTOM_MODEL_NAME"
  // Custom OpenAI-compatible endpoint for Codex ("Custom Codex" tab). Mirrors the
  // Anthropic fields above: only a base URL is required, and auth is supplied
  // through CUSTOM_CODEX_HEADERS (e.g. `Authorization: Bearer …`) rather than a
  // dedicated key field. At run time these are passed through to the sandbox and
  // turned into a ~/.codex/config.toml custom model_provider (see the SDK's
  // codexSetup / buildCodexConfigToml).
  | "CUSTOM_CODEX_BASE_URL"
  | "CUSTOM_CODEX_HEADERS"
  | "CUSTOM_CODEX_NAME"
  // Custom OpenAI-compatible endpoint for OpenCode ("OpenCode" target on the
  // Custom model tab). Like the others, only a base URL is required and auth is
  // supplied through CUSTOM_OPENCODE_HEADERS. At run time these become a
  // ~/.config/opencode/opencode.json custom provider (see buildOpencodeConfigJson
  // in the SDK). The model id is required here — OpenCode addresses models as
  // `<provider>/<model>`, so there is no "endpoint default".
  | "CUSTOM_OPENCODE_BASE_URL"
  | "CUSTOM_OPENCODE_HEADERS"
  | "CUSTOM_OPENCODE_NAME"

export type CredentialFlags = Partial<Record<CredentialId, boolean>> & {
  // Server has a shared Claude credential pool (e.g. the rotating row written
  // by simple-chat's /api/cron/refresh-claude-creds). Treated as a Claude Code
  // credential at the UI gate so the user can pick claude-code without pasting
  // their own token. Not a CredentialId — it's a server capability, not an env var.
  CLAUDE_SHARED_POOL_AVAILABLE?: boolean
  // Free user has hit daily limit on shared Claude credentials. When true,
  // hasCredentialsForModel stops treating the shared pool as usable for
  // Claude models, so the UI falls back to a model the user can actually run.
  CLAUDE_DAILY_LIMIT_EXCEEDED?: boolean
  // Whether the OPENCODE_API_KEY originates from the server environment (shared)
  OPENCODE_API_KEY_SHARED?: boolean
  // Whether the OPENCODE_API_KEY is a user-provided credential stored in DB
  OPENCODE_API_KEY_USER?: boolean
}
export type Credentials = Partial<Record<CredentialId, string>>

/** Env vars to inject for a given provider. */
const PROVIDER_ENV: Record<ProviderId, CredentialId[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  github: ["COPILOT_GITHUB_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  kilo: ["KILO_API_KEY"],
  kimi: ["KIMI_API_KEY"],
}

// =============================================================================
// Model Configuration
// =============================================================================

export interface ModelOption {
  value: string
  label: string
  /**
   * Which provider's API key is required for this model. "none" means no key
   * needed. "custom" means the user-configured custom Anthropic endpoint (see
   * the CUSTOM_MODEL_* credentials). "codex-custom" means the user-configured
   * custom OpenAI-compatible Codex endpoint (see the CUSTOM_CODEX_* credentials).
   * "opencode-custom" is the equivalent for OpenCode (see CUSTOM_OPENCODE_*).
   */
  requiresKey?: ProviderId | "none" | "custom" | "codex-custom" | "opencode-custom"
}

/**
 * Sentinel model value for the user-configured custom Anthropic endpoint.
 * When selected (claude-code only), the stored CUSTOM_MODEL_* credentials are
 * injected as ANTHROPIC_* env vars instead of the shared pool / API key.
 */
export const CUSTOM_MODEL_VALUE = "custom"

/**
 * Sentinel model value for the user-configured custom Codex endpoint.
 * When selected (codex only), the stored CUSTOM_CODEX_* credentials drive a
 * custom ~/.codex/config.toml model_provider instead of the OpenAI default.
 */
export const CUSTOM_CODEX_MODEL_VALUE = "codex-custom"

/**
 * Sentinel model value for the user-configured custom OpenCode endpoint.
 * When selected (opencode only), the stored CUSTOM_OPENCODE_* credentials drive a
 * custom ~/.config/opencode/opencode.json provider; resolveCliModel maps it to
 * `custom/<model id>`.
 */
export const CUSTOM_OPENCODE_MODEL_VALUE = "opencode-custom"

/**
 * Models allowed to run on the server-shared OpenCode API key.
 *
 * The shared key is an OpenCode **Go** subscription key, so these must use the
 * `opencode-go/` prefix to route through Go (the $10/mo pool the key pays for).
 * The `opencode/` prefix would route through OpenCode **Zen** (pay-as-you-go),
 * where the Go key has no balance — that yields an "insufficient balance" error.
 */
const SHARED_OPENCODE_ALLOWED = new Set<string>([
  "opencode-go/glm-5",
  "opencode-go/glm-5.1",
  "opencode-go/kimi-k2.5",
  "opencode-go/kimi-k2.6",
  "opencode-go/mimo-v2.5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/minimax-m2.5",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m3",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.7-max",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash",
])

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "default", label: "Default", requiresKey: "anthropic" },
    { value: "fable", label: "Fable", requiresKey: "anthropic" },
    { value: "sonnet", label: "Sonnet", requiresKey: "anthropic" },
    { value: "opus", label: "Opus", requiresKey: "anthropic" },
    { value: "haiku", label: "Haiku", requiresKey: "anthropic" },
    { value: CUSTOM_MODEL_VALUE, label: "Custom model", requiresKey: "custom" },
  ],
  "eliza": [
    { value: "eliza-classic-1.0", label: "Eliza Classic", requiresKey: "none" },
  ],
  "opencode": [
    // Free models (opencode/) - no API key needed
    { value: "opencode/big-pickle", label: "Big Pickle (Free)", requiresKey: "none" },
    { value: "opencode/nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)", requiresKey: "none" },
    { value: "opencode/deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)", requiresKey: "none" },
    { value: "opencode/mimo-v2.5-free", label: "MiMo v2.5 (Free)", requiresKey: "none" },
    // Curated OpenCode Go models (opencode-go/ prefix), runnable on the
    // server-shared Go subscription key. Shown first when OPENCODE_API_KEY is
    // available. These route through Go, not Zen — see SHARED_OPENCODE_ALLOWED.
    { value: "opencode-go/glm-5", label: "GLM-5 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/glm-5.1", label: "GLM-5.1 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/kimi-k2.5", label: "Kimi K2.5 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/kimi-k2.6", label: "Kimi K2.6 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/mimo-v2.5", label: "MiMo v2.5 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/mimo-v2.5-pro", label: "MiMo v2.5 Pro (Go)", requiresKey: "opencode" },
    { value: "opencode-go/minimax-m2.5", label: "MiniMax M2.5 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/minimax-m2.7", label: "MiniMax M2.7 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/minimax-m3", label: "MiniMax M3 (Go)", requiresKey: "opencode" },
    { value: "opencode-go/qwen3.6-plus", label: "Qwen3.6 Plus (Go)", requiresKey: "opencode" },
    { value: "opencode-go/qwen3.7-max", label: "Qwen3.7 Max (Go)", requiresKey: "opencode" },
    { value: "opencode-go/deepseek-v4-pro", label: "DeepSeek V4 Pro (Go)", requiresKey: "opencode" },
    { value: "opencode-go/deepseek-v4-flash", label: "DeepSeek V4 Flash (Go)", requiresKey: "opencode" },

    // Remaining paid models — route through OpenCode Zen (pay-as-you-go credits).
    // Preserve original order, excluding duplicates.
    { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-6", label: "Claude Opus 4.6 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-7", label: "Claude Opus 4.7 (Zen)", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-8", label: "Claude Opus 4.8 (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5", label: "GPT-5 (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5-codex", label: "GPT-5 Codex (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5.1-codex", label: "GPT-5.1 Codex (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5-nano", label: "GPT-5 Nano (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5.4", label: "GPT-5.4 (Zen)", requiresKey: "opencode" },
    { value: "opencode/gpt-5.5", label: "GPT-5.5 (Zen)", requiresKey: "opencode" },
    { value: "opencode/gemini-3-flash", label: "Gemini 3 Flash (Zen)", requiresKey: "opencode" },
    { value: "opencode/gemini-3.5-flash", label: "Gemini 3.5 Flash (Zen)", requiresKey: "opencode" },
    { value: "opencode/gemini-3.1-pro", label: "Gemini 3.1 Pro (Zen)", requiresKey: "opencode" },
    // Anthropic direct models — route to Anthropic on the user's own Anthropic key
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "anthropic" },
    // OpenAI direct models — route to OpenAI on the user's own OpenAI key
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
    { value: CUSTOM_OPENCODE_MODEL_VALUE, label: "Custom endpoint", requiresKey: "opencode-custom" },
  ],
  "codex": [
    { value: "gpt-5.5", label: "GPT-5.5 (Recommended)", requiresKey: "openai" },
    { value: "gpt-5.4", label: "GPT-5.4", requiresKey: "openai" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", requiresKey: "openai" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", requiresKey: "openai" },
    { value: CUSTOM_CODEX_MODEL_VALUE, label: "Custom endpoint", requiresKey: "codex-custom" },
  ],
  "copilot": [
    { value: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", requiresKey: "github" },
    { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", requiresKey: "github" },
    { value: "claude-opus-4.6", label: "Claude Opus 4.6", requiresKey: "github" },
    { value: "claude-opus-4.8", label: "Claude Opus 4.8", requiresKey: "github" },
    { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "github" },
    { value: "gpt-5.5", label: "GPT-5.5", requiresKey: "github" },
    { value: "gpt-5.4", label: "GPT-5.4", requiresKey: "github" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "github" },
    { value: "gpt-5-mini", label: "GPT-5 Mini", requiresKey: "github" },
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", requiresKey: "github" },
    { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro", requiresKey: "github" },
    { value: "gemini-3-flash", label: "Gemini 3 Flash", requiresKey: "github" },
  ],
  "gemini": [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Recommended)", requiresKey: "gemini" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "gemini" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro", requiresKey: "gemini" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", requiresKey: "gemini" },
  ],
  "goose": [
    { value: "gpt-4o", label: "GPT-4o (Recommended)", requiresKey: "openai" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
  ],
  "kilo": [
    // Auto-routers
    { value: "kilo/kilo-auto/free", label: "Auto Free", requiresKey: "none" },
    { value: "kilo/kilo-auto/balanced", label: "Auto Balanced", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/frontier", label: "Auto Frontier", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/small", label: "Auto Small", requiresKey: "kilo" },
    // Free models
    { value: "kilo/deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash (Free)", requiresKey: "none" },
    { value: "kilo/nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (Free)", requiresKey: "none" },
    { value: "kilo/stepfun/step-3.5-flash:free", label: "Step 3.5 Flash (Free)", requiresKey: "none" },
    // Anthropic via Kilo gateway
    { value: "kilo/anthropic/claude-opus-4.7", label: "Claude Opus 4.7", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "kilo" },
    // OpenAI via Kilo gateway
    { value: "kilo/openai/gpt-5.5", label: "GPT-5.5", requiresKey: "kilo" },
    { value: "kilo/openai/gpt-5.4", label: "GPT-5.4", requiresKey: "kilo" },
    { value: "kilo/openai/o3", label: "o3", requiresKey: "kilo" },
    { value: "kilo/openai/o4-mini", label: "o4 Mini", requiresKey: "kilo" },
    // Google via Kilo gateway
    { value: "kilo/google/gemini-3-pro-preview", label: "Gemini 3 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "kilo" },
    // DeepSeek via Kilo gateway
    { value: "kilo/deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "kilo" },
    { value: "kilo/deepseek/deepseek-r1-0528", label: "DeepSeek R1", requiresKey: "kilo" },
    // Other notable models
    { value: "kilo/moonshotai/kimi-k2.6", label: "Kimi K2.6", requiresKey: "kilo" },
    { value: "kilo/qwen/qwen3-coder", label: "Qwen3 Coder", requiresKey: "kilo" },
    { value: "kilo/mistralai/devstral-medium", label: "Devstral Medium", requiresKey: "kilo" },
    { value: "kilo/x-ai/grok-4.20", label: "Grok 4.20", requiresKey: "kilo" },
  ],
  "kimi": [
    // Moonshot (Kimi) models, routed through the user's KIMI_API_KEY against
    // https://api.moonshot.ai/v1. Each value must match a [models."<id>"] entry
    // declared in the generated ~/.kimi-code/config.toml (see the kimi agent).
    { value: "kimi-k2.7-code", label: "Kimi K2.7 Code (Recommended)", requiresKey: "kimi" },
    { value: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", requiresKey: "kimi" },
    { value: "kimi-k2.6", label: "Kimi K2.6", requiresKey: "kimi" },
    { value: "kimi-k2.5", label: "Kimi K2.5", requiresKey: "kimi" },
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
  "opencode": "opencode-go/mimo-v2.5-pro",
  "codex": "gpt-5.5",
  "copilot": "gpt-5-mini",
  "eliza": "eliza-classic-1.0", // Fake agent, no API key needed
  "gemini": "gemini-2.5-flash",
  "goose": "gpt-4o",
  "kilo": "kilo/kilo-auto/free", // Free auto-router, no API key needed
  "kimi": "kimi-k2.7-code",
  "pi": "claude-sonnet-4-5",
}

/** Whether each agent supports plan mode (read-only execution) */
export const agentSupportsPlanMode: Record<Agent, boolean> = {
  "claude-code": true,
  "opencode": false,
  "codex": true,
  "copilot": false,
  "eliza": false,
  "gemini": true,
  "goose": true,
  "kilo": false,
  "kimi": false,
  "pi": false,
}

// =============================================================================
// Credential queries
// =============================================================================

/**
 * Get the default agent. Always defaults to OpenCode.
 */
export function getDefaultAgent(): Agent {
  return "opencode"
}

/** Whether the user has their own Anthropic credentials (API key or subscription token). */
export function hasOwnAnthropicCredentials(flags: CredentialFlags | null | undefined): boolean {
  return !!flags?.ANTHROPIC_API_KEY || !!flags?.CLAUDE_CODE_CREDENTIALS
}

/**
 * Whether a Claude run would draw from the server's shared Claude pool: the
 * shared pool is available and the user has no personal Anthropic credentials.
 * Does not account for the daily limit — see CLAUDE_DAILY_LIMIT_EXCEEDED.
 */
export function sharedClaudePoolEligible(flags: CredentialFlags | null | undefined): boolean {
  return !!flags?.CLAUDE_SHARED_POOL_AVAILABLE && !hasOwnAnthropicCredentials(flags)
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
  if (model.requiresKey === "custom") {
    // Custom endpoint is usable once a base URL is configured. Auth, if the
    // endpoint needs it, is supplied via custom headers (x-api-key /
    // Authorization) — see buildCustomModelEnv — so it isn't required here.
    return !!flags?.CUSTOM_MODEL_BASE_URL
  }
  if (model.requiresKey === "codex-custom") {
    // Same contract as the Anthropic custom endpoint: usable once a base URL is
    // set; auth is supplied through CUSTOM_CODEX_HEADERS, not a separate key.
    return !!flags?.CUSTOM_CODEX_BASE_URL
  }
  if (model.requiresKey === "opencode-custom") {
    return !!flags?.CUSTOM_OPENCODE_BASE_URL
  }
  if (model.requiresKey === "anthropic") {
    // OpenCode and Pi require an API key — they can't drive a subscription session.
    if (agent === "opencode" || agent === "pi") return !!flags?.ANTHROPIC_API_KEY
    // Claude Code can use either API key, the user's pasted subscription, or the shared pool.
    // But if daily limit is exceeded on the shared pool, don't consider it usable.
    if (flags?.CLAUDE_DAILY_LIMIT_EXCEEDED) {
      return !!flags?.ANTHROPIC_API_KEY || !!flags?.CLAUDE_CODE_CREDENTIALS
    }
    return !!(flags?.ANTHROPIC_API_KEY || flags?.CLAUDE_CODE_CREDENTIALS || flags?.CLAUDE_SHARED_POOL_AVAILABLE)
  }
  if (model.requiresKey === "opencode") {
    // If the user has their own stored OpenCode key, allow all opencode models
    if (flags?.OPENCODE_API_KEY_USER) return true
    // If only the server-shared key is available, allow only a curated subset
    if (flags?.OPENCODE_API_KEY_SHARED) {
      return SHARED_OPENCODE_ALLOWED.has(model.value)
    }
    return false
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
  // Custom Anthropic endpoint wins over everything (incl. the shared pool /
  // subscription token) when the user explicitly selects the custom model.
  if ((!agent || agent === "claude-code") && model === CUSTOM_MODEL_VALUE) {
    return buildCustomModelEnv(credentials)
  }

  // Custom Codex endpoint: pass the stored CUSTOM_CODEX_* values through to the
  // sandbox. The Codex CLI is config-file driven (not env driven), so the SDK's
  // codexSetup reads these env vars and writes ~/.codex/config.toml from them.
  if (agent === "codex" && model === CUSTOM_CODEX_MODEL_VALUE) {
    return buildCodexCustomEnv(credentials)
  }

  // Custom OpenCode endpoint: same as Codex — passed through and turned into a
  // ~/.config/opencode/opencode.json provider by the SDK's opencodeSetup.
  if (agent === "opencode" && model === CUSTOM_OPENCODE_MODEL_VALUE) {
    return buildOpencodeCustomEnv(credentials)
  }

  // Claude Code: subscription token wins over API key.
  if ((!agent || agent === "claude-code") && credentials.CLAUDE_CODE_CREDENTIALS) {
    return { CLAUDE_CODE_CREDENTIALS: credentials.CLAUDE_CODE_CREDENTIALS }
  }

  const opt = agent ? (agentModels[agent] ?? []).find((m) => m.value === model) : undefined
  if (!opt?.requiresKey || opt.requiresKey === "none") return {}
  if (opt.requiresKey === "custom") return buildCustomModelEnv(credentials)
  if (opt.requiresKey === "codex-custom") return buildCodexCustomEnv(credentials)
  if (opt.requiresKey === "opencode-custom") return buildOpencodeCustomEnv(credentials)

  const env: Record<string, string> = {}
  for (const id of PROVIDER_ENV[opt.requiresKey]) {
    const v = credentials[id]
    if (v) env[id] = v
  }
  if (env.GEMINI_API_KEY) env.GOOGLE_API_KEY = env.GEMINI_API_KEY
  return env
}

export interface ParsedCustomHeaders {
  /** Value of an `x-api-key:` line, mapped to ANTHROPIC_API_KEY. */
  apiKey?: string
  /** Value of an `Authorization:` line (any `Bearer ` prefix stripped), mapped to ANTHROPIC_AUTH_TOKEN. */
  authToken?: string
  /** The remaining (non-auth) headers as a cleaned blob, or undefined if none. */
  headers?: string
}

/**
 * Parse a user-supplied custom-headers blob (newline-separated `Name: Value`
 * pairs). Auth headers are promoted to the canonical env vars the Claude CLI
 * understands so the run actually authenticates (and the CLI starts):
 *   `x-api-key: …`      → apiKey   (→ ANTHROPIC_API_KEY)
 *   `Authorization: …`  → authToken (→ ANTHROPIC_AUTH_TOKEN, `Bearer ` stripped)
 * `anthropic-version` is dropped (the CLI manages it). Everything else passes
 * through as additional request headers. Malformed/empty lines are ignored.
 */
export function parseCustomHeaders(raw: string): ParsedCustomHeaders {
  let apiKey: string | undefined
  let authToken: string | undefined
  const kept: string[] = []
  for (const line of raw.split("\n").map((l) => l.trim())) {
    if (!line) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue // no name, or no colon
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (!value) continue
    if (name === "x-api-key") {
      apiKey = value
    } else if (name === "authorization") {
      authToken = value.replace(/^Bearer\s+/i, "")
    } else if (name === "anthropic-version") {
      // Managed by the CLI — ignore.
    } else {
      kept.push(`${line.slice(0, idx).trim()}: ${value}`)
    }
  }
  return { apiKey, authToken, headers: kept.length > 0 ? kept.join("\n") : undefined }
}

/**
 * Map the stored CUSTOM_MODEL_* credentials to the standard Anthropic env vars
 * the Claude CLI understands:
 *   CUSTOM_MODEL_BASE_URL → ANTHROPIC_BASE_URL
 *   CUSTOM_MODEL_HEADERS  → ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (auth headers,
 *                           promoted) + ANTHROPIC_CUSTOM_HEADERS (the rest)
 * The model NAME is applied separately as the CLI --model arg (resolveCliModel).
 * Deliberately never includes CLAUDE_CODE_CREDENTIALS, so a custom run can never
 * leak the shared-pool token.
 */
export function buildCustomModelEnv(credentials: Credentials): Record<string, string> {
  const env: Record<string, string> = {}
  if (credentials.CUSTOM_MODEL_BASE_URL) env.ANTHROPIC_BASE_URL = credentials.CUSTOM_MODEL_BASE_URL
  if (credentials.CUSTOM_MODEL_HEADERS) {
    const { apiKey, authToken, headers } = parseCustomHeaders(credentials.CUSTOM_MODEL_HEADERS)
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken
    if (headers) env.ANTHROPIC_CUSTOM_HEADERS = headers
  }
  return env
}

/** Return the verbatim value of a named header from a `Name: Value` blob. */
function extractHeaderValue(raw: string, headerName: string): string | undefined {
  const target = headerName.toLowerCase()
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf(":")
    if (idx <= 0) continue
    if (trimmed.slice(0, idx).trim().toLowerCase() === target) {
      return trimmed.slice(idx + 1).trim() || undefined
    }
  }
  return undefined
}

/**
 * Pass the stored CUSTOM_CODEX_* credentials through to the sandbox. The Codex
 * CLI takes a custom endpoint via ~/.codex/config.toml rather than env vars, so
 * the SDK's codexSetup reads these back and generates the config file — see
 * buildCodexConfigToml in the SDK.
 *
 * Auth handling: Codex drops the Authorization header for a custom base_url when
 * it's supplied via `env_key` or a static http_header (the header is lost on the
 * transport fallback — see openai/codex#15492). The path that survives is
 * `env_http_headers`, which injects a header from a named env var. So we copy the
 * user's *full* `Authorization` value (incl. the `Bearer ` prefix, verbatim) into
 * a CUSTOM_CODEX_AUTHORIZATION env var; the generated config maps the
 * Authorization header to it via env_http_headers. The raw blob still rides along
 * for any non-auth headers.
 *
 * Deliberately never includes OPENAI_API_KEY, so a custom Codex run can't fall
 * back to a stored OpenAI key.
 */
export function buildCodexCustomEnv(credentials: Credentials): Record<string, string> {
  const env: Record<string, string> = {}
  if (credentials.CUSTOM_CODEX_BASE_URL) env.CUSTOM_CODEX_BASE_URL = credentials.CUSTOM_CODEX_BASE_URL
  if (credentials.CUSTOM_CODEX_NAME) env.CUSTOM_CODEX_NAME = credentials.CUSTOM_CODEX_NAME
  if (credentials.CUSTOM_CODEX_HEADERS) {
    env.CUSTOM_CODEX_HEADERS = credentials.CUSTOM_CODEX_HEADERS
    const authorization = extractHeaderValue(credentials.CUSTOM_CODEX_HEADERS, "Authorization")
    if (authorization) env.CUSTOM_CODEX_AUTHORIZATION = authorization
  }
  return env
}

/**
 * Pass the stored CUSTOM_OPENCODE_* credentials through to the sandbox. OpenCode
 * takes a custom provider via ~/.config/opencode/opencode.json, so the SDK's
 * opencodeSetup reads these back and writes that file — see buildOpencodeConfigJson.
 *
 * Auth: OpenCode's openai-compatible provider sends `Authorization: Bearer
 * <apiKey>`, so we promote the user's Authorization token (Bearer stripped) into
 * CUSTOM_OPENCODE_API_KEY, which the config references via `{env:...}`. Other
 * headers (incl. x-api-key) ride along in the blob for the SDK to emit verbatim.
 *
 * Deliberately never includes OPENCODE_API_KEY, so a custom run can't fall back
 * to a stored OpenCode key.
 */
export function buildOpencodeCustomEnv(credentials: Credentials): Record<string, string> {
  const env: Record<string, string> = {}
  if (credentials.CUSTOM_OPENCODE_BASE_URL) env.CUSTOM_OPENCODE_BASE_URL = credentials.CUSTOM_OPENCODE_BASE_URL
  if (credentials.CUSTOM_OPENCODE_NAME) env.CUSTOM_OPENCODE_NAME = credentials.CUSTOM_OPENCODE_NAME
  if (credentials.CUSTOM_OPENCODE_HEADERS) {
    env.CUSTOM_OPENCODE_HEADERS = credentials.CUSTOM_OPENCODE_HEADERS
    const { authToken } = parseCustomHeaders(credentials.CUSTOM_OPENCODE_HEADERS)
    if (authToken) env.CUSTOM_OPENCODE_API_KEY = authToken
  }
  return env
}

/**
 * Resolve the model string passed to the CLI's --model flag. For a custom
 * endpoint the dropdown value is a sentinel, so translate it to the user's
 * configured model name (or undefined → endpoint default). All other models
 * pass through unchanged.
 */
export function resolveCliModel(
  model: string | undefined,
  credentials: Credentials
): string | undefined {
  if (model === CUSTOM_MODEL_VALUE) {
    return credentials.CUSTOM_MODEL_NAME || undefined
  }
  if (model === CUSTOM_CODEX_MODEL_VALUE) {
    return credentials.CUSTOM_CODEX_NAME || undefined
  }
  if (model === CUSTOM_OPENCODE_MODEL_VALUE) {
    // OpenCode addresses models as `<provider>/<model>`; "custom" is the provider
    // id written by buildOpencodeConfigJson.
    return credentials.CUSTOM_OPENCODE_NAME
      ? `custom/${credentials.CUSTOM_OPENCODE_NAME}`
      : undefined
  }
  return model
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
