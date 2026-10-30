/**
 * Agent configuration and metadata
 * Shared between web and simple-chat packages
 */

import type { ModelOption } from "./agent-models"
import {
  agentModels,
  defaultAgentModel,
  agentSupportsPlanMode,
  SHARED_OPENCODE_ALLOWED,
  SHARED_GEMINI_POOL_PRO_MODELS,
  SHARED_CLAUDE_POOL_EXCLUDED_MODELS,
} from "./agent-models"

// Re-exported so existing consumers importing these from "./agents" (or via
// the package's index.ts barrel) don't need to change — the model catalog
// itself lives in ./agent-models, see that file's header comment for why.
export type { ModelOption } from "./agent-models"
export { agentModels, defaultAgentModel, agentSupportsPlanMode } from "./agent-models"

// =============================================================================
// Agent Types
// =============================================================================

export type Agent = "claude-code" | "opencode" | "codex" | "command-code" | "copilot" | "droid" | "eliza" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/**
 * All agent ids, in display order. Agents backed by a server shared pool
 * (claude-code, opencode, gemini) lead, with Kilo (free models, no shared
 * pool) placed ahead of Gemini, then the remaining providers.
 */
export const ALL_AGENTS: Agent[] = ["claude-code", "opencode", "kilo", "gemini", "droid", "command-code", "pi", "codex", "copilot", "goose", "kimi", "eliza"]

/** SDK provider names (must match ProviderName from SDK) */
export type ProviderName = "claude" | "codex" | "commandcode" | "copilot" | "droid" | "eliza" | "opencode" | "gemini" | "goose" | "kilo" | "kimi" | "pi"

/** Display labels for each agent */
export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
  "codex": "Codex",
  "command-code": "Command Code",
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
  "command-code": "commandcode",
  "copilot": "copilot",
  "droid": "droid",
  "eliza": "eliza",
  "gemini": "gemini",
  "goose": "goose",
  "kilo": "kilo",
  "kimi": "kimi",
  "pi": "pi",
}

/** Reverse of {@link agentToProvider}: SDK provider name → agent id. */
export const providerToAgent: Record<ProviderName, Agent> = Object.fromEntries(
  ALL_AGENTS.map((agent) => [agentToProvider[agent], agent])
) as Record<ProviderName, Agent>

/**
 * Human label for an SDK provider name, resolved via its agent. Falls back to
 * capitalizing the raw id for providers with no agent mapping.
 */
export function providerLabel(provider: string): string {
  const agent = providerToAgent[provider as ProviderName]
  return agent ? agentLabels[agent] : provider.charAt(0).toUpperCase() + provider.slice(1)
}

// =============================================================================
// Credentials
// =============================================================================

/** Provider an API key is associated with. */
export type ProviderId = "anthropic" | "commandcode" | "github" | "openai" | "opencode" | "gemini" | "kilo" | "kimi" | "factory" | "netlify"

/**
 * Credential identifiers. The id doubles as the env var name we inject
 * into the agent process, so the storage and runtime shapes are the same.
 */
export type CredentialId =
  | "ANTHROPIC_API_KEY"
  | "CLAUDE_CODE_CREDENTIALS"
  | "CODEX_CREDENTIALS"
  | "COMMAND_CODE_API_KEY"
  | "COPILOT_GITHUB_TOKEN"
  | "OPENAI_API_KEY"
  | "OPENCODE_API_KEY"
  | "GEMINI_API_KEY"
  | "KILO_API_KEY"
  | "KIMI_API_KEY"
  | "FACTORY_API_KEY"
  | "NETLIFY_OAUTH_TOKEN"

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
  commandcode: ["COMMAND_CODE_API_KEY"],
  github: ["COPILOT_GITHUB_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  kilo: ["KILO_API_KEY"],
  kimi: ["KIMI_API_KEY"],
  factory: ["FACTORY_API_KEY"],
  // Deploy-only; never injected into an agent.
  netlify: [],
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
  "command-code": "command-code",
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
  "commandcode": "command-code",
  "cmd": "command-code",
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
 * that need no API key (see getFreeModelForAgent). Kilo qualifies via its free
 * auto-router and free model tier; OpenCode qualifies via its no-key models
 * (opencode/big-pickle, etc.) — both stay available even when the user adds
 * their own key for that agent, and even once a metered shared pool is
 * exhausted, since they never draw on it. Used to surface the "Free usage
 * available" green dot in the agent picker. For agents without an always-free
 * model, this returns false once their shared pool is exhausted (see
 * agentSharedPoolExhausted).
 */
export function agentHasFreeUsage(
  agent: Agent,
  flags: CredentialFlags | null | undefined
): boolean {
  if (getFreeModelForAgent(agent)) return true
  if (agentSharedPoolExhausted(agent, flags)) return false
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
    // GPT-5.5 retired from ChatGPT sign-in, not the API. Subscription auth
    // wins when both credentials exist (getEnvForModel / Codex setup), so an
    // API key must not falsely unlock it on a subscription-backed run.
    if (model.value === "gpt-5.5") {
      return !!flags?.OPENAI_API_KEY && !flags?.CODEX_CREDENTIALS
    }
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
