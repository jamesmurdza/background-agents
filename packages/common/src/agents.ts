/**
 * Agent configuration and metadata
 * Shared between web and simple-chat packages
 */

// =============================================================================
// Agent Types
// =============================================================================

export type Agent = "claude-code" | "opencode" | "codex" | "copilot" | "droid" | "eliza" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/**
 * All agent ids, in display order. Agents backed by a server shared pool
 * (claude-code, opencode, gemini) lead, with Kilo (free models, no shared
 * pool) placed ahead of Gemini, then the remaining providers.
 */
export const ALL_AGENTS: Agent[] = ["claude-code", "opencode", "kilo", "gemini", "droid", "pi", "codex", "copilot", "goose", "kimi", "eliza"]

/** SDK provider names (must match ProviderName from SDK) */
export type ProviderName = "claude" | "codex" | "copilot" | "droid" | "eliza" | "opencode" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/** Display labels for each agent */
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "copilot": "GitHub Copilot",
  "droid": "Factory Droid",
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
  "droid": "droid",
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
export type ProviderId = "anthropic" | "github" | "openai" | "opencode" | "gemini" | "kilo" | "kimi" | "factory"

/**
 * Credential identifiers. The id doubles as the env var name we inject
 * into the agent process, so the storage and runtime shapes are the same.
 */
export type CredentialId =
  | "ANTHROPIC_API_KEY"
  | "CLAUDE_CODE_CREDENTIALS"
  | "CODEX_CREDENTIALS"
  | "COPILOT_GITHUB_TOKEN"
  | "OPENAI_API_KEY"
  | "OPENCODE_API_KEY"
  | "GEMINI_API_KEY"
  | "KILO_API_KEY"
  | "KIMI_API_KEY"
  | "FACTORY_API_KEY"

export type CredentialFlags = Partial<Record<CredentialId, boolean>> & {
  // Server has a shared Claude credential pool (e.g. the rotating row written
  // by simple-chat's /api/cron/refresh-claude-creds). Treated as a Claude Code
  // credential at the UI gate so the user can pick claude-code without pasting
  // their own token. Not a CredentialId — it's a server capability, not an env var.
  CLAUDE_SHARED_POOL_AVAILABLE?: boolean
  // User has spent their daily balance. It is pooled across every shared pool
  // (Claude, OpenCode, Gemini), so when true hasCredentialsForModel stops
  // treating ANY shared pool as usable and the UI falls back to a model the user
  // can actually run — their own key, or a free model, which never draws it.
  SHARED_BALANCE_EXHAUSTED?: boolean
  // Whether the OPENCODE_API_KEY originates from the server environment (shared)
  OPENCODE_API_KEY_SHARED?: boolean
  // Whether the OPENCODE_API_KEY is a user-provided credential stored in DB
  OPENCODE_API_KEY_USER?: boolean
  // Whether the GEMINI_API_KEY originates from the server environment (shared)
  GEMINI_API_KEY_SHARED?: boolean
  // Whether the GEMINI_API_KEY is a user-provided credential stored in DB
  GEMINI_API_KEY_USER?: boolean
}
export type Credentials = Partial<Record<CredentialId, string>>

// =============================================================================
// Custom endpoints
// =============================================================================

/**
 * Which runtime drives a custom endpoint. The type the user picks in the
 * "Custom endpoints" settings tab *is* the agent the endpoint runs on:
 *   anthropic → Claude Code (ANTHROPIC_* env vars)
 *   codex     → Codex (~/.codex/config.toml)
 *   opencode  → OpenCode (~/.config/opencode/opencode.json)
 */
export type CustomEndpointType = "anthropic" | "codex" | "opencode"

/**
 * A user-defined custom endpoint. Users manage a list of these (add / edit /
 * duplicate / delete) in settings; each appears by name in the model dropdown
 * under its runtime agent. Auth is supplied through the `headers` blob (e.g.
 * `x-api-key:` / `Authorization:`), not a dedicated field. The `headers` value
 * is the only secret-bearing field and is encrypted at rest.
 */
export interface CustomEndpoint {
  /** Stable id; a chat's `model` is `endpoint:<id>` when this endpoint is selected. */
  id: string
  /** Display name, shown in the settings list and the model dropdown. */
  name: string
  type: CustomEndpointType
  /** Endpoint base URL (e.g. https://api.anthropic.com, https://openrouter.ai/api/v1). */
  baseUrl: string
  /** Model id passed to the CLI. Optional for anthropic/codex; required for opencode. */
  model: string
  /** Newline-separated `Name: Value` header lines; auth lives here. */
  headers: string
}

/** Maps an endpoint type to the agent that runs it. */
export const ENDPOINT_TYPE_TO_AGENT: Record<CustomEndpointType, Agent> = {
  anthropic: "claude-code",
  codex: "codex",
  opencode: "opencode",
}

/** Prefix marking a model value that references a custom endpoint by id. */
export const ENDPOINT_MODEL_PREFIX = "endpoint:"

/** Resolve the selected endpoint for a model value, or undefined if not one. */
export function findEndpoint(
  model: string | undefined,
  endpoints: CustomEndpoint[] | undefined
): CustomEndpoint | undefined {
  if (!model || !model.startsWith(ENDPOINT_MODEL_PREFIX)) return undefined
  const id = model.slice(ENDPOINT_MODEL_PREFIX.length)
  return endpoints?.find((e) => e.id === id)
}

/** Env vars to inject for a given provider. */
const PROVIDER_ENV: Record<ProviderId, CredentialId[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  github: ["COPILOT_GITHUB_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  kilo: ["KILO_API_KEY"],
  kimi: ["KIMI_API_KEY"],
  factory: ["FACTORY_API_KEY"],
}

// =============================================================================
// Model Configuration
// =============================================================================

export interface ModelOption {
  value: string
  label: string
  /**
   * Which provider's API key is required for this model. "none" means no key
   * needed — which also covers custom-endpoint options (value `endpoint:<id>`),
   * whose connection config travels with the endpoint itself.
   */
  requiresKey?: ProviderId | "none"
  /**
   * Published input rate in USD per million tokens; 0 means free. A *list* rate —
   * the picker divides it by the shared pool's discount before showing it.
   * Omitted for custom endpoints and auto routers, whose cost isn't known ahead
   * of time.
   */
  priceUsdPerM?: number
}

/**
 * Models allowed to run on the server-shared OpenCode API key.
 *
 * The shared key is an OpenCode **Go** subscription key, so these must use the
 * `opencode-go/` prefix to route through Go (the $10/mo pool the key pays for).
 * The `opencode/` prefix would route through OpenCode **Zen** (pay-as-you-go),
 * where the Go key has no balance — that yields an "insufficient balance" error.
 */
const SHARED_OPENCODE_ALLOWED = new Set<string>([
  "opencode-go/glm-5.1",
  "opencode-go/glm-5.2",
  "opencode-go/kimi-k2.6",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/mimo-v2.5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/minimax-m2.5",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m3",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.7-plus",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash",
])

/**
 * Pro-tier Gemini models (requiresKey "gemini") that the server-shared Gemini
 * pool must NOT unlock, across every agent that exposes them (Gemini, Pi,
 * Droid). The shared key backs only the cheaper Flash tier for free usage;
 * running Pro requires the user's own stored GEMINI_API_KEY. New Flash models
 * stay available by default — only the ids listed here are gated.
 */
const SHARED_GEMINI_POOL_PRO_MODELS = new Set<string>([
  "gemini-3.1-pro-preview",
  "google/gemini-3.1-pro-preview",
])

/**
 * Claude Code models the server-shared Claude pool must NOT unlock. Unlike every
 * other anthropic model on claude-code, these run only on the user's OWN key or
 * subscription token — never the free shared pool. Fable ($10/M) is too costly to
 * serve for free, so it's BYOK-only. This also retroactively gates existing chats
 * still pointed at such a model: with no personal Anthropic credential the picker
 * shows a lock and the send path (hasRequiredCredentials) blocks the turn.
 */
const SHARED_CLAUDE_POOL_EXCLUDED_MODELS = new Set<string>(["fable"])

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "sonnet", label: "Sonnet", requiresKey: "anthropic", priceUsdPerM: 2 },
    { value: "opus", label: "Opus", requiresKey: "anthropic", priceUsdPerM: 5 },
    { value: "haiku", label: "Haiku", requiresKey: "anthropic", priceUsdPerM: 1 },
    // BYOK-only: excluded from the shared Claude pool (see
    // SHARED_CLAUDE_POOL_EXCLUDED_MODELS). priceUsdPerM is shown as an indicative
    // list rate even though the user runs it on their own key.
    { value: "fable", label: "Fable", requiresKey: "anthropic", priceUsdPerM: 10 },
    { value: "default", label: "Auto", requiresKey: "anthropic" },
    { value: "best", label: "Best", requiresKey: "anthropic" },
  ],
  "eliza": [
    { value: "eliza-classic-1.0", label: "Eliza Classic", requiresKey: "none", priceUsdPerM: 0 },
  ],
  "opencode": [
    // Free models (opencode/) - no API key needed
    { value: "opencode/big-pickle", label: "Big Pickle", requiresKey: "none", priceUsdPerM: 0 },
    { value: "opencode/nemotron-3-ultra-free", label: "Nemotron 3 Ultra", requiresKey: "none", priceUsdPerM: 0 },
    { value: "opencode/mimo-v2.5-free", label: "MiMo v2.5", requiresKey: "none", priceUsdPerM: 0 },
    // Curated OpenCode Go models (opencode-go/ prefix), runnable on the
    // server-shared Go subscription key. Shown first when OPENCODE_API_KEY is
    // available. These route through Go, not Zen — see SHARED_OPENCODE_ALLOWED.
    // priceUsdPerM is the input $/M-token rate from OpenCode's published Go rate card.
    { value: "opencode-go/glm-5.1", label: "GLM-5.1", requiresKey: "opencode", priceUsdPerM: 1.4 },
    { value: "opencode-go/glm-5.2", label: "GLM-5.2", requiresKey: "opencode", priceUsdPerM: 1.4 },
    { value: "opencode-go/kimi-k2.6", label: "Kimi K2.6", requiresKey: "opencode", priceUsdPerM: 0.95 },
    { value: "opencode-go/kimi-k2.7-code", label: "Kimi K2.7 Code", requiresKey: "opencode", priceUsdPerM: 0.95 },
    { value: "opencode-go/mimo-v2.5", label: "MiMo v2.5", requiresKey: "opencode", priceUsdPerM: 0.14 },
    { value: "opencode-go/mimo-v2.5-pro", label: "MiMo v2.5 Pro", requiresKey: "opencode", priceUsdPerM: 0.44 },
    { value: "opencode-go/minimax-m2.5", label: "MiniMax M2.5", requiresKey: "opencode", priceUsdPerM: 0.3 },
    { value: "opencode-go/minimax-m2.7", label: "MiniMax M2.7", requiresKey: "opencode", priceUsdPerM: 0.3 },
    { value: "opencode-go/minimax-m3", label: "MiniMax M3", requiresKey: "opencode", priceUsdPerM: 0.3 },
    { value: "opencode-go/qwen3.6-plus", label: "Qwen3.6 Plus", requiresKey: "opencode", priceUsdPerM: 0.5 },
    { value: "opencode-go/qwen3.7-max", label: "Qwen3.7 Max", requiresKey: "opencode", priceUsdPerM: 2.5 },
    { value: "opencode-go/qwen3.7-plus", label: "Qwen3.7 Plus", requiresKey: "opencode", priceUsdPerM: 0.4 },
    { value: "opencode-go/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "opencode", priceUsdPerM: 0.66 },
    { value: "opencode-go/deepseek-v4-flash", label: "DeepSeek V4 Flash", requiresKey: "opencode", priceUsdPerM: 0.22 },

    // Remaining paid models — route through OpenCode Zen (pay-as-you-go credits).
    // Preserve original order, excluding duplicates.
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "opencode" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "opencode" },
    { value: "opencode/claude-opus-5", label: "Claude Opus 5", requiresKey: "opencode" },
    { value: "opencode/claude-fable-5", label: "Claude Fable 5", requiresKey: "opencode" },
    { value: "opencode/gpt-5", label: "GPT-5", requiresKey: "opencode" },
    { value: "opencode/gpt-5-codex", label: "GPT-5 Codex", requiresKey: "opencode" },
    { value: "opencode/gpt-5.1-codex", label: "GPT-5.1 Codex", requiresKey: "opencode" },
    { value: "opencode/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "opencode" },
    { value: "opencode/gpt-5.4", label: "GPT-5.4", requiresKey: "opencode" },
    { value: "opencode/gpt-5.5", label: "GPT-5.5", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-sol", label: "GPT-5.6 Sol", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-terra", label: "GPT-5.6 Terra", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-luna", label: "GPT-5.6 Luna", requiresKey: "opencode" },
    { value: "opencode/gemini-3-flash", label: "Gemini 3 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.5-flash", label: "Gemini 3.5 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.1-pro", label: "Gemini 3.1 Pro", requiresKey: "opencode" },
    // Anthropic direct models — route to Anthropic on the user's own Anthropic key
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-5", label: "Claude Opus 5", requiresKey: "anthropic" },
    { value: "anthropic/claude-fable-5", label: "Claude Fable 5", requiresKey: "anthropic" },
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
  ],
  "codex": [
    { value: "gpt-6-astra", label: "GPT-6 Astra", requiresKey: "openai" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", requiresKey: "openai" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", requiresKey: "openai" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", requiresKey: "openai" },
    { value: "gpt-5.5", label: "GPT-5.5", requiresKey: "openai" },
    { value: "gpt-5.4", label: "GPT-5.4", requiresKey: "openai" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", requiresKey: "openai" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", requiresKey: "openai" },
  ],
  "copilot": [
    { value: "claude-fable-5", label: "Claude Fable 5", requiresKey: "github" },
    { value: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", requiresKey: "github" },
    { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", requiresKey: "github" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "github" },
    { value: "claude-opus-5", label: "Claude Opus 5", requiresKey: "github" },
    { value: "claude-opus-4.6", label: "Claude Opus 4.6", requiresKey: "github" },
    { value: "claude-opus-4.8", label: "Claude Opus 4.8", requiresKey: "github" },
    { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "github" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", requiresKey: "github" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", requiresKey: "github" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", requiresKey: "github" },
    { value: "gpt-5.5", label: "GPT-5.5", requiresKey: "github" },
    { value: "gpt-5.4", label: "GPT-5.4", requiresKey: "github" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "github" },
    { value: "gpt-5-mini", label: "GPT-5 Mini", requiresKey: "github" },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", requiresKey: "github" },
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", requiresKey: "github" },
    { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro", requiresKey: "github" },
  ],
  "gemini": [
    // Default first, then Flash tier (newest → oldest), then Pro.
    // Flash-tier priceUsdPerM is the input $/M rate — these run on the shared
    // Gemini pool (see SHARED_GEMINI_POOL_PRO_MODELS). Pro is BYOK-only, so it
    // gets no label — its cost isn't drawn from our shared key.
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", requiresKey: "gemini", priceUsdPerM: 1.5 },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", requiresKey: "gemini", priceUsdPerM: 0.5 },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
  ],
  "goose": [
    { value: "gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
  ],
  "kilo": [
    // Auto-routers
    { value: "kilo/kilo-auto/free", label: "Auto Free", requiresKey: "none", priceUsdPerM: 0 },
    { value: "kilo/kilo-auto/frontier", label: "Auto Frontier", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/efficient", label: "Auto Efficient", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/small", label: "Auto Small", requiresKey: "kilo" },
    // Free models
    { value: "kilo/deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash", requiresKey: "none", priceUsdPerM: 0 },
    { value: "kilo/nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", requiresKey: "none", priceUsdPerM: 0 },
    { value: "kilo/stepfun/step-3.7-flash:free", label: "Step 3.7 Flash", requiresKey: "none", priceUsdPerM: 0 },
    // Anthropic via Kilo gateway
    { value: "kilo/anthropic/claude-fable-5", label: "Claude Fable 5", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-opus-4.8", label: "Claude Opus 4.8", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-opus-4.7", label: "Claude Opus 4.7", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "kilo" },
    // OpenAI via Kilo gateway
    { value: "kilo/openai/gpt-5.5", label: "GPT-5.5", requiresKey: "kilo" },
    { value: "kilo/openai/gpt-5.4", label: "GPT-5.4", requiresKey: "kilo" },
    // Google via Kilo gateway
    { value: "kilo/google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "kilo" },
    // DeepSeek via Kilo gateway
    { value: "kilo/deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "kilo" },
    // Other notable models
    { value: "kilo/moonshotai/kimi-k2.6", label: "Kimi K2.6", requiresKey: "kilo" },
    { value: "kilo/qwen/qwen3-coder", label: "Qwen3 Coder", requiresKey: "kilo" },
    { value: "kilo/mistralai/devstral-medium", label: "Devstral Medium", requiresKey: "kilo" },
    { value: "kilo/x-ai/grok-4.3", label: "Grok 4.3", requiresKey: "kilo" },
  ],
  "kimi": [
    // Moonshot (Kimi) models, routed through the user's KIMI_API_KEY against
    // https://api.moonshot.ai/v1. Each value must match a [models."<id>"] entry
    // declared in the generated ~/.kimi-code/config.toml (see the kimi agent).
    { value: "kimi-k3", label: "Kimi K3", requiresKey: "kimi" },
    { value: "kimi-k2.7-code", label: "Kimi K2.7 Code", requiresKey: "kimi" },
    { value: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", requiresKey: "kimi" },
    { value: "kimi-k2.6", label: "Kimi K2.6", requiresKey: "kimi" },
  ],
  "droid": [
    // Two paths, both selectable here:
    //
    // 1. BYOK (requiresKey anthropic|openai|gemini) — droid runs on the user's OWN
    //    key, no Factory account needed. The droid SDK agent writes the model as a
    //    `custom:byok-0` entry in ~/.factory/settings.json and selects it with
    //    `droid exec -m custom:byok-0`. Each value is the exact upstream API model
    //    id (POSTed to api.anthropic.com / api.openai.com / Gemini's OpenAI-compat
    //    endpoint), so it must be a real provider id.
    //
    // 2. Factory-hosted (requiresKey factory) — routed through Factory's platform
    //    on the user's FACTORY_API_KEY. Value is `factory/<catalog-id>`; the SDK
    //    strips the prefix and passes the raw built-in id (no customModels entry).
    //    These are droid's built-in catalog ids — Factory bills the inference.
    //
    // ── BYOK: Anthropic (ids per the claude-api reference) ──
    { value: "claude-opus-5", label: "Claude Opus 5", requiresKey: "anthropic" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "anthropic" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "anthropic" },
    { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    // ── BYOK: OpenAI ──
    { value: "gpt-5", label: "GPT-5", requiresKey: "openai" },
    { value: "gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
    { value: "gpt-5-codex", label: "GPT-5 Codex", requiresKey: "openai" },
    { value: "gpt-4.1", label: "GPT-4.1", requiresKey: "openai" },
    { value: "gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "o3", label: "o3", requiresKey: "openai" },
    { value: "o4-mini", label: "o4 Mini", requiresKey: "openai" },
    // ── BYOK: Gemini (Google's OpenAI-compatible endpoint) ──
    // Flash tier also runs on the shared Gemini pool (see
    // SHARED_GEMINI_POOL_PRO_MODELS), hence the priceUsdPerM; Pro is BYOK-only.
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", requiresKey: "gemini", priceUsdPerM: 1.5 },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", requiresKey: "gemini", priceUsdPerM: 0.5 },
    // ── Factory-hosted (FACTORY_API_KEY; droid's built-in catalog). There is NO
    // free/no-key tier — verified: every built-in model 401s without a Factory key.
    { value: "factory/claude-fable-5", label: "Claude Fable 5 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-opus-4-8", label: "Claude Opus 4.8 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Factory)", requiresKey: "factory" },
    { value: "factory/gpt-5.6-sol", label: "GPT-5.6 Sol (Factory)", requiresKey: "factory" },
    { value: "factory/gemini-3.5-flash", label: "Gemini 3.5 Flash (Factory)", requiresKey: "factory" },
    { value: "factory/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Factory)", requiresKey: "factory" },
    { value: "factory/glm-5.2", label: "GLM 5.2 (Factory)", requiresKey: "factory" },
    { value: "factory/kimi-k2.7-code", label: "Kimi K2.7 Code (Factory)", requiresKey: "factory" },
  ],
  "pi": [
    // Anthropic models (default provider)
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    // OpenAI models
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5", label: "GPT-5", requiresKey: "openai" },
    // Google models — Flash also runs on the shared Gemini pool; Pro is BYOK-only.
    { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini", priceUsdPerM: 0.3 },
  ],
}

/** Default model per agent */
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "sonnet",
  "opencode": "opencode-go/mimo-v2.5-pro",
  "codex": "gpt-5.5",
  "copilot": "gpt-5-mini",
  "droid": "claude-sonnet-4-5-20250929", // BYOK default (user's ANTHROPIC_API_KEY)
  "eliza": "eliza-classic-1.0", // Fake agent, no API key needed
  "gemini": "gemini-3.5-flash-lite", // fast/cheap Flash Lite; free-tier available & reliable
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
  "droid": false,
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

/**
 * Friendly URL slugs → agent id, for deep links like `/agent/factory`.
 *
 * Every canonical agent id maps to itself, plus a few human-friendly aliases
 * (e.g. `factory` → `droid`, `claude` → `claude-code`). Lookups via
 * `resolveAgentSlug` are case-insensitive.
 */
export const agentSlugs: Record<string, Agent> = {
  // Canonical ids (each id is a valid slug)
  "claude-code": "claude-code",
  "opencode": "opencode",
  "codex": "codex",
  "copilot": "copilot",
  "droid": "droid",
  "eliza": "eliza",
  "gemini": "gemini",
  "goose": "goose",
  "kilo": "kilo",
  "kimi": "kimi",
  "pi": "pi",
  // Friendly aliases
  "claude": "claude-code",
  "factory": "droid",
}

/**
 * Resolve a URL slug to an agent id, case-insensitively. Returns `null` for
 * unknown slugs so callers can fall back to the default agent.
 */
export function resolveAgentSlug(slug: string | null | undefined): Agent | null {
  if (!slug) return null
  return agentSlugs[slug.toLowerCase()] ?? null
}

/** Whether the user has their own Anthropic credentials (API key or subscription token). */
export function hasOwnAnthropicCredentials(flags: CredentialFlags | null | undefined): boolean {
  return !!flags?.ANTHROPIC_API_KEY || !!flags?.CLAUDE_CODE_CREDENTIALS
}

/**
 * Whether a Claude run would draw from the server's shared Claude pool: the
 * shared pool is available and the user has no personal Anthropic credentials.
 * Does not account for the daily balance — see SHARED_BALANCE_EXHAUSTED.
 */
export function sharedClaudePoolEligible(flags: CredentialFlags | null | undefined): boolean {
  return !!flags?.CLAUDE_SHARED_POOL_AVAILABLE && !hasOwnAnthropicCredentials(flags)
}

/**
 * Whether picking this agent would draw from a server-provided shared pool
 * (free usage) instead of the user's own key. Used to surface a "free usage
 * available" indicator in the agent picker. Returns false once the user stores
 * their own key for that provider. Agents without a shared pool are always false.
 */
export function agentUsesSharedPool(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  switch (agent) {
    case "claude-code":
      return sharedClaudePoolEligible(flags)
    case "opencode":
      return !!flags?.OPENCODE_API_KEY_SHARED
    case "gemini":
      return !!flags?.GEMINI_API_KEY_SHARED
    default:
      return false
  }
}

/**
 * A $/M rate as the picker shows it: "$2/M", "$1.40/M", "30¢/M", or "FREE".
 * Cents below a dollar, where the rates land once the discount is applied.
 */
export function formatTokenRate(usdPerM: number): string {
  if (!Number.isFinite(usdPerM) || usdPerM <= 0) return "FREE"
  if (usdPerM >= 1) {
    const dollars = Number.isInteger(usdPerM) ? String(usdPerM) : usdPerM.toFixed(2)
    return `$${dollars}/M`
  }
  const cents = usdPerM * 100
  const rounded = cents >= 1 ? Math.round(cents * 10) / 10 : Math.round(cents * 100) / 100
  return `${rounded}¢/M`
}

/**
 * The shared pool a run with this agent+model would meter against, or null when
 * it runs on the user's own key (or is free). Client mirror of `providerForRun` +
 * `resolvePool` in web's lib/server/shared-pool, but per model rather than per
 * agent: the allow/deny sets above decide which models a shared key can serve.
 *
 * The picker uses it to discount the displayed price — only pool runs get one.
 */
export function sharedPoolProviderForModel(
  agent: Agent,
  model: string | undefined,
  flags: CredentialFlags | null | undefined
): ProviderName | null {
  // A custom endpoint is the user's own connection, never a pool; free models
  // are never charged, so neither has a discount.
  if (!model || model.startsWith(ENDPOINT_MODEL_PREFIX)) return null
  const requiresKey = modelRequiresKey(agent, model)
  if (!requiresKey || requiresKey === "none") return null

  // A Gemini model runs on the shared Gemini key under any agent (Pi, Droid, …).
  if (requiresKey === "gemini") {
    if (!flags?.GEMINI_API_KEY_SHARED || flags?.GEMINI_API_KEY_USER) return null
    return SHARED_GEMINI_POOL_PRO_MODELS.has(model) ? null : "gemini"
  }

  switch (agent) {
    case "claude-code":
      if (requiresKey !== "anthropic") return null
      if (SHARED_CLAUDE_POOL_EXCLUDED_MODELS.has(model)) return null
      return sharedClaudePoolEligible(flags) ? "claude" : null
    case "opencode":
      if (requiresKey !== "opencode") return null
      if (!flags?.OPENCODE_API_KEY_SHARED || flags?.OPENCODE_API_KEY_USER) return null
      return SHARED_OPENCODE_ALLOWED.has(model) ? "opencode" : null
    default:
      return null
  }
}

/**
 * Whether the agent's only route to usage is a shared pool that's been used up,
 * leaving nothing the user can actually run. The balance is pooled across all
 * three shared pools, so spending it closes every one of them at once —
 * but only for a user who is actually drawing on that pool. agentUsesSharedPool
 * already returns false once the user stores their own key, so someone with a
 * personal credential keeps working with a zero balance. The agent picker
 * shows a yellow dot for this state — distinct from "ready" (green) and "needs
 * setup" (no dot).
 */
export function agentSharedPoolExhausted(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  return !!flags?.SHARED_BALANCE_EXHAUSTED && agentUsesSharedPool(agent, flags)
}

/**
 * Whether picking this agent gives free usage out of the box — either a
 * server-provided shared pool (see agentUsesSharedPool) or always-free models
 * that need no API key. Kilo qualifies via its free auto-router and free model
 * tier, which stay available even when the user adds their own Kilo key. Used to
 * surface the "Free usage available" green dot in the agent picker. Returns
 * false once a metered shared pool is exhausted (see agentSharedPoolExhausted).
 */
export function agentHasFreeUsage(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  if (agentSharedPoolExhausted(agent, flags)) return false
  if (agent === "kilo") return true
  return agentUsesSharedPool(agent, flags)
}

/**
 * Whether picking this agent would work right now without any further setup —
 * either it has free usage (see agentHasFreeUsage) or the user has the
 * credentials needed for at least one of its models (their own API key, a
 * subscription token, etc.). Used to surface the green "ready to use" dot in the
 * agent picker so it covers any agent that's set up to go, not just free ones.
 */
export function agentIsReady(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  if (agentHasFreeUsage(agent, flags)) return true
  const models = agentModels[agent] ?? []
  return models.some((m) => hasCredentialsForModel(m, flags, agent))
}

/**
 * Check if user has credentials for a specific model.
 */
export function hasCredentialsForModel(
  model: ModelOption,
  flags: CredentialFlags | null | undefined,
  agent?: Agent
): boolean {
  // Custom-endpoint options (value `endpoint:<id>`) carry their own connection
  // config, so they need no provider key — they're "none" and return above.
  if (!model.requiresKey || model.requiresKey === "none") return true
  if (model.requiresKey === "anthropic") {
    // Only Claude Code can drive a subscription session or the shared Claude
    // pool — those credentials are injected server-side for claude-code alone
    // (see resolveSendCredentials). Every other agent (OpenCode, Pi, Goose, …)
    // needs a real API key.
    if (agent !== "claude-code") return !!flags?.ANTHROPIC_API_KEY
    // BYOK-only Claude models (e.g. Fable) never run on the shared pool — they
    // require the user's own API key or subscription, regardless of balance. This
    // is what gates existing chats still pointed at such a model.
    if (SHARED_CLAUDE_POOL_EXCLUDED_MODELS.has(model.value)) {
      return !!flags?.ANTHROPIC_API_KEY || !!flags?.CLAUDE_CODE_CREDENTIALS
    }
    // Claude Code can use either API key, the user's pasted subscription, or the shared pool.
    // With the credit allowance spent, only the user's own credentials remain.
    if (flags?.SHARED_BALANCE_EXHAUSTED) {
      return !!flags?.ANTHROPIC_API_KEY || !!flags?.CLAUDE_CODE_CREDENTIALS
    }
    return !!(flags?.ANTHROPIC_API_KEY || flags?.CLAUDE_CODE_CREDENTIALS || flags?.CLAUDE_SHARED_POOL_AVAILABLE)
  }
  if (model.requiresKey === "opencode") {
    // If the user has their own stored OpenCode key, allow all opencode models
    if (flags?.OPENCODE_API_KEY_USER) return true
    // If only the server-shared key is available, allow only a curated subset —
    // and only while the user still has balance. OpenCode's free models never
    // reach here (requiresKey "none" returns true above), so they stay usable.
    if (flags?.OPENCODE_API_KEY_SHARED) {
      if (flags?.SHARED_BALANCE_EXHAUSTED) return false
      return SHARED_OPENCODE_ALLOWED.has(model.value)
    }
    return false
  }
  if (model.requiresKey === "gemini") {
    // When only the server-shared Gemini key is available (no user-owned key),
    // the free pool backs only the cheaper Flash tier — Pro-tier Gemini models
    // stay locked across every agent until the user adds their own key.
    if (flags?.GEMINI_API_KEY_SHARED && !flags?.GEMINI_API_KEY_USER) {
      if (flags?.SHARED_BALANCE_EXHAUSTED) return false
      return !SHARED_GEMINI_POOL_PRO_MODELS.has(model.value)
    }
    // Otherwise the user's own Gemini key unlocks every Gemini model.
    return !!flags?.GEMINI_API_KEY
  }
  if (model.requiresKey === "openai") {
    // A ChatGPT subscription only drives the Codex CLI — the blob is written to
    // ~/.codex/auth.json, which no other agent reads. Every other agent needs a
    // real platform API key. Mirrors the claude-code rule above.
    if (agent !== "codex") return !!flags?.OPENAI_API_KEY
    return !!(flags?.OPENAI_API_KEY || flags?.CODEX_CREDENTIALS)
  }

  return PROVIDER_ENV[model.requiresKey].some((id) => flags?.[id])
}

/**
 * The provider key a given agent+model requires ("anthropic" / "gemini" / …),
 * "none" for no-key models, or undefined when the model isn't in the agent's
 * list. The lookup is agent-scoped because the same model id can require a
 * different key under different agents. Used server-side to decide which shared
 * pool a run draws from (e.g. a Gemini model under Pi/Droid uses the shared
 * Gemini key — see resolvePool / providerForRun).
 */
export function modelRequiresKey(
  agent: Agent,
  model: string | undefined
): ProviderId | "none" | undefined {
  if (!model) return undefined
  return (agentModels[agent] ?? []).find((m) => m.value === model)?.requiresKey
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
 * The agent's first model that needs no credential at all, or undefined when it
 * has none. OpenCode's free tier is the one that matters: it never draws
 * the balance, so it stays usable once a user's daily balance is spent.
 *
 * Deliberately takes no flags. getDefaultModelForAgent would also land here once
 * SHARED_BALANCE_EXHAUSTED is set, but that flag arrives with the settings query
 * and can be a request behind — when we already know the balance is gone (a 429
 * just came back), picking the free model outright avoids retrying into the same
 * wall.
 */
export function getFreeModelForAgent(agent: Agent): string | undefined {
  return (agentModels[agent] ?? []).find((m) => m.requiresKey === "none")?.value
}

/**
 * Resolve which model an agent should use, honoring the user's saved default
 * model preference when it makes sense.
 *
 * `preferredModel` is the user's settings default (`settings.defaultModel`). It
 * is stored as a pair with `settings.defaultAgent`, so it only ever belongs to
 * one agent. We honor it only when it actually belongs to the agent we're
 * resolving for AND the user can use it right now (free or configured — no lock
 * icon); otherwise the preference is irrelevant or broken and we fall back to
 * the standard default (first usable model, else the hardcoded default).
 *
 * Membership is checked against `getAgentModels`, so a saved preference pointing
 * at a custom endpoint resolves correctly when endpoints are supplied.
 */
export function resolveModelForAgent(
  agent: Agent,
  flags: CredentialFlags | null | undefined,
  preferredModel: string | null | undefined,
  endpoints?: CustomEndpoint[]
): string {
  if (preferredModel) {
    const models = getAgentModels(agent, endpoints)
    const preferredConfig = models.find(m => m.value === preferredModel)
    if (preferredConfig && hasCredentialsForModel(preferredConfig, flags, agent)) {
      return preferredModel
    }
  }
  return getDefaultModelForAgent(agent, flags)
}

/**
 * Resolve the model a chat should actually run on.
 *
 * Normally the chat's own stored model, but it downgrades to the agent's default
 * usable model (via resolveModelForAgent) when the stored model isn't runnable
 * for this user — either it's locked (no credentials, e.g. a BYOK-only model like
 * Fable on a keyless account) or it's no longer offered by the agent (removed from
 * the picker). This keeps an existing chat sending instead of stranding it on a
 * model it can never use — the composer would otherwise just block with a lock.
 *
 * A stored model the user *can* run is always kept, so a chat on Fable with the
 * user's own Anthropic key stays on Fable.
 */
export function resolveChatModel(
  agent: Agent,
  storedModel: string | null | undefined,
  flags: CredentialFlags | null | undefined,
  preferredModel?: string | null | undefined,
  endpoints?: CustomEndpoint[]
): string {
  if (storedModel) {
    const models = getAgentModels(agent, endpoints)
    const config = models.find((m) => m.value === storedModel)
    if (config && hasCredentialsForModel(config, flags, agent)) return storedModel
  }
  return resolveModelForAgent(agent, flags, preferredModel, endpoints)
}

/**
 * Resolve which agent to use, following the precedence:
 * caller-preferred → user's saved default → the hardcoded default agent.
 * Centralizes the `as Agent` cast so call sites don't each repeat it.
 */
export function resolveAgent(
  preferred: string | null | undefined,
  settingsDefault: string | null | undefined
): Agent {
  return (preferred ?? settingsDefault ?? getDefaultAgent()) as Agent
}

/**
 * Resolve an agent and its model together — the canonical pairing used wherever
 * a new send/draft/chat needs both. The caller passes whatever it already knows
 * (an explicit choice, the chat's current value, etc.) as the preferred values;
 * everything else falls back through the user's settings to the defaults via
 * resolveAgent / resolveModelForAgent.
 */
export function resolveAgentAndModel(
  preferredAgent: string | null | undefined,
  preferredModel: string | null | undefined,
  settings: { defaultAgent?: string | null; defaultModel?: string | null },
  flags: CredentialFlags | null | undefined,
  endpoints?: CustomEndpoint[]
): { agent: Agent; model: string } {
  const agent = resolveAgent(preferredAgent, settings.defaultAgent)
  const model = preferredModel ?? resolveModelForAgent(agent, flags, settings.defaultModel, endpoints)
  return { agent, model }
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
  credentials: Credentials,
  endpoints?: CustomEndpoint[]
): Record<string, string> {
  // A selected custom endpoint wins over everything (incl. the shared pool /
  // subscription token). It emits the same env var names the SDK setup functions
  // already consume (ANTHROPIC_* / CUSTOM_CODEX_* / CUSTOM_OPENCODE_*), so the
  // sandbox side is unchanged — only the source of the values differs.
  const endpoint = findEndpoint(model, endpoints)
  if (endpoint) return buildEndpointEnv(endpoint)

  // Claude Code: subscription token wins over API key.
  if ((!agent || agent === "claude-code") && credentials.CLAUDE_CODE_CREDENTIALS) {
    return { CLAUDE_CODE_CREDENTIALS: credentials.CLAUDE_CODE_CREDENTIALS }
  }

  // Codex: subscription blob wins over API key. The value is a complete
  // auth.json rendered by the web layer (lib/codex-credentials), already
  // carrying a placeholder refresh token.
  if (agent === "codex" && credentials.CODEX_CREDENTIALS) {
    return { CODEX_CREDENTIALS: credentials.CODEX_CREDENTIALS }
  }

  // Droid runs BYOK: each model routes to the user's own key via the customModels
  // `${ANTHROPIC_API_KEY}` / `${OPENAI_API_KEY}` references droid resolves from the
  // process env (see the droid SDK agent) — so inject whichever provider keys are
  // set. No Factory login is needed for BYOK, but if the user did save a
  // FACTORY_API_KEY we still pass it through (harmless; enables Factory-hosted
  // routing if they ever select a built-in model id).
  if (agent === "droid") {
    const env: Record<string, string> = {}
    if (credentials.FACTORY_API_KEY) env.FACTORY_API_KEY = credentials.FACTORY_API_KEY
    if (credentials.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = credentials.ANTHROPIC_API_KEY
    if (credentials.OPENAI_API_KEY) env.OPENAI_API_KEY = credentials.OPENAI_API_KEY
    if (credentials.GEMINI_API_KEY) env.GEMINI_API_KEY = credentials.GEMINI_API_KEY
    return env
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
/**
 * Parse a single `Name: Value` header line into its (case-folded) name, the
 * original-cased name, and the trimmed value. Returns null for blank lines or
 * lines without a `name:` prefix.
 */
function parseHeaderLine(line: string): { name: string; rawName: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf(":")
  if (idx <= 0) return null // no name, or no colon
  const rawName = trimmed.slice(0, idx).trim()
  return { name: rawName.toLowerCase(), rawName, value: trimmed.slice(idx + 1).trim() }
}

export function parseCustomHeaders(raw: string): ParsedCustomHeaders {
  let apiKey: string | undefined
  let authToken: string | undefined
  const kept: string[] = []
  for (const line of raw.split("\n")) {
    const parsed = parseHeaderLine(line)
    if (!parsed) continue
    const { name, rawName, value } = parsed
    if (!value) continue
    if (name === "x-api-key") {
      apiKey = value
    } else if (name === "authorization") {
      authToken = value.replace(/^Bearer\s+/i, "")
    } else if (name === "anthropic-version") {
      // Managed by the CLI — ignore.
    } else {
      kept.push(`${rawName}: ${value}`)
    }
  }
  return { apiKey, authToken, headers: kept.length > 0 ? kept.join("\n") : undefined }
}

/** Build the env vars for a selected custom endpoint, dispatching on its type. */
export function buildEndpointEnv(endpoint: CustomEndpoint): Record<string, string> {
  switch (endpoint.type) {
    case "anthropic":
      return buildCustomModelEnv(endpoint)
    case "codex":
      return buildCodexCustomEnv(endpoint)
    case "opencode":
      return buildOpencodeCustomEnv(endpoint)
  }
}

/**
 * Map an Anthropic-type endpoint to the standard Anthropic env vars the Claude
 * CLI understands:
 *   baseUrl → ANTHROPIC_BASE_URL
 *   headers → ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (auth headers, promoted)
 *             + ANTHROPIC_CUSTOM_HEADERS (the rest)
 * The model is applied separately as the CLI --model arg (resolveCliModel).
 * Deliberately never includes CLAUDE_CODE_CREDENTIALS, so a custom run can never
 * leak the shared-pool token.
 */
export function buildCustomModelEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.ANTHROPIC_BASE_URL = endpoint.baseUrl
  if (endpoint.headers) {
    const { apiKey, authToken, headers } = parseCustomHeaders(endpoint.headers)
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
    if (line.trim().startsWith("#")) continue // comment line
    const parsed = parseHeaderLine(line)
    if (!parsed) continue
    if (parsed.name === target) return parsed.value || undefined
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
export function buildCodexCustomEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.CUSTOM_CODEX_BASE_URL = endpoint.baseUrl
  if (endpoint.model) env.CUSTOM_CODEX_NAME = endpoint.model
  if (endpoint.headers) {
    env.CUSTOM_CODEX_HEADERS = endpoint.headers
    const authorization = extractHeaderValue(endpoint.headers, "Authorization")
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
export function buildOpencodeCustomEnv(endpoint: CustomEndpoint): Record<string, string> {
  const env: Record<string, string> = {}
  if (endpoint.baseUrl) env.CUSTOM_OPENCODE_BASE_URL = endpoint.baseUrl
  if (endpoint.model) env.CUSTOM_OPENCODE_NAME = endpoint.model
  if (endpoint.headers) {
    env.CUSTOM_OPENCODE_HEADERS = endpoint.headers
    const { authToken } = parseCustomHeaders(endpoint.headers)
    if (authToken) env.CUSTOM_OPENCODE_API_KEY = authToken
  }
  return env
}

/**
 * Resolve the model string passed to the CLI's --model flag. For a custom
 * endpoint the dropdown value is `endpoint:<id>`, so translate it to the
 * endpoint's configured model (or undefined → endpoint default). OpenCode
 * addresses models as `<provider>/<model>`, where "custom" is the provider id
 * written by buildOpencodeConfigJson. All other models pass through unchanged.
 */
export function resolveCliModel(
  model: string | undefined,
  endpoints?: CustomEndpoint[]
): string | undefined {
  const endpoint = findEndpoint(model, endpoints)
  if (endpoint) {
    if (endpoint.type === "opencode") {
      return endpoint.model ? `custom/${endpoint.model}` : undefined
    }
    return endpoint.model || undefined
  }
  return model
}

/**
 * Models available for an agent, including the user's custom endpoints whose
 * type maps to that agent (each as an `endpoint:<id>` option labeled by name).
 */
export function getAgentModels(
  agent: Agent,
  endpoints?: CustomEndpoint[]
): ModelOption[] {
  const base = agentModels[agent] ?? []
  if (!endpoints?.length) return base
  const extra: ModelOption[] = endpoints
    .filter((e) => ENDPOINT_TYPE_TO_AGENT[e.type] === agent)
    .map((e) => ({ value: ENDPOINT_MODEL_PREFIX + e.id, label: e.name, requiresKey: "none" }))
  return [...base, ...extra]
}

/**
 * Get model label from model value. A custom endpoint resolves to its name; a
 * stale `endpoint:<id>` (endpoint since deleted) falls back to "Custom endpoint".
 */
export function getModelLabel(
  agent: Agent,
  modelValue: string | undefined,
  endpoints?: CustomEndpoint[]
): string {
  if (!modelValue) {
    modelValue = defaultAgentModel[agent]
  }
  if (modelValue.startsWith(ENDPOINT_MODEL_PREFIX)) {
    return findEndpoint(modelValue, endpoints)?.name ?? "Custom endpoint"
  }
  const models = agentModels[agent] ?? []
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}
