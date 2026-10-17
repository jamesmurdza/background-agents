/** Browser-safe capability contract. No provider credentials or Node imports. */
import { piModelIdentity } from "./agents/pi/model-identity"

export const THINKING_LEVELS = ["default", "none", "off", "on", "adaptive", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const
/** A string remains safe to freeze in queues and older message metadata. */
export type ThinkingLevel = typeof THINKING_LEVELS[number] | `budget:${number}` | `variant:${string}`

export type ThinkingCapabilityStatus = "available" | "no_controls" | "unverified" | "runtime_unavailable" | "check_failed"
export const THINKING_CLI_TIMEOUT_SECONDS = 10
export const THINKING_SERVER_TIMEOUT_MS = 15_000
export const THINKING_BROWSER_TIMEOUT_MS = 20_000

export interface ThinkingCapability {
  readonly levels: readonly ThinkingLevel[]
  readonly control?: "codex-config" | "claude-effort" | "opencode-variant" | "kilo-variant" | "commandcode-effort" | "copilot-effort" | "droid-effort" | "pi-thinking" | "gemini-config" | "kimi-env"
  readonly budget?: { min: number; max: number }
  readonly reason?: string
  readonly runtimeRequired?: boolean
  /** Discovery outcome, not a claim that this account can call the provider. */
  readonly status?: ThinkingCapabilityStatus
  readonly runtimeVersion?: string
  readonly provenance?: {
    readonly source: "verified_catalog" | "native_catalog" | "runtime_version" | "policy"
    readonly evidence: string
    readonly runtimeVersion?: string
  }
}

const basic = ["low", "medium", "high"] as const
const extended = [...basic, "xhigh", "max"] as const
const unknown: ThinkingCapability = {
  levels: [], reason: "Thinking controls have not been verified for this agent and model. Use Default.",
}

/**
 * Deliberately conservative: a model being able to reason does not prove its
 * agent/provider exposes a control. Add combinations only with native evidence.
 * These are expected capabilities; launch also checks the installed CLI.
 * Custom endpoints and auto routers cannot inherit the official model's contract.
 */
function expectedThinkingCapability(agent: string, model?: string): ThinkingCapability {
  if (!model || model.startsWith("endpoint:")) return unknown
  if (agent === "codex") {
    // Verified against the 0.159.3 runtime catalog. Luna does not expose ultra.
    if (["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol"].includes(model)) return { levels: [...extended, "ultra"], control: "codex-config" }
    if (model === "gpt-6-luna") return { levels: extended, control: "codex-config" }
    if (model === "gpt-5.5") return { levels: [...basic, "xhigh"], control: "codex-config" }
  }
  if (agent === "claude") {
    // Aliases can resolve to different releases. Only their common supported
    // levels are offered. Exact versions can expose additional native levels.
    if (["sonnet", "opus"].includes(model) || /^claude-(opus|sonnet)-4-6(?:-\d{8})?$/.test(model)) {
      return { levels: [...basic, "max"], control: "claude-effort" }
    }
    if (model === "fable" || /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(model)) {
      return { levels: extended, control: "claude-effort" }
    }
  }
  if (agent === "opencode") {
    // Variant names are a request vocabulary, NOT advertised support. The
    // installed CLI's provider catalog is authoritative, even for free models.
    if (/^[a-z0-9-]+\/[a-zA-Z0-9._:/-]+$/.test(model) && !model.startsWith("custom/")) {
      return { levels: THINKING_LEVELS.filter(level => level !== "default"), control: "opencode-variant", runtimeRequired: true }
    }
  }
  if (agent === "kilo" && /^[a-z0-9-]+\/[a-zA-Z0-9._:/-]+$/.test(model) && !model.includes("kilo-auto/")) {
    // Like OpenCode, these names are an input vocabulary, not native support.
    return { levels: THINKING_LEVELS.filter(level => level !== "default"), control: "kilo-variant", runtimeRequired: true }
  }
  if (agent === "commandcode" || agent === "copilot") {
    // These gateways have their own catalogs; do not inherit Codex's ultra or
    // Anthropic aliases. Native preflight also checks the installed runtime.
    const id = model.replaceAll(".", "-")
    const claude = /^claude-(?:fable-5(?:-1)?|opus-(?:4-[78]|5(?:-5)?)|sonnet-5(?:-5)?|haiku-5-5)$/.test(id)
    const openai = /^gpt-(?:6(?:-1)?-(?:sol|astra|luna)|5-6-(?:sol|terra|luna))$/.test(id)
    const older = /^gpt-5-(?:3-codex|4|5)$/.test(id)
    if (claude || openai || older) return { levels: older ? [...basic, "xhigh"] : extended, control: agent === "copilot" ? "copilot-effort" : "commandcode-effort", runtimeRequired: true }
  }
  if (agent === "droid") {
    if (!model.startsWith("factory/")) return { levels: [], reason: "Droid's reasoning flag does not apply to BYOK models. Their provider controls thinking; use Default." }
    const id = model.slice(8)
    const levels: readonly ThinkingLevel[] | undefined =
      ["gpt-6.1-sol", "gpt-6-astra", "claude-opus-5-5"].includes(id) ? extended :
      ["gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(id) ? ["none", ...extended] :
      ["claude-fable-5", "claude-fable-5.1", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-5", "claude-sonnet-5", "claude-sonnet-5-5"].includes(id) ? ["off", ...extended] :
      ["claude-sonnet-4-6", "claude-opus-4-6"].includes(id) ? ["off", ...basic, "max"] :
      ["gemini-3.8-flash", "gemini-3.1-pro-preview"].includes(id) ? basic :
      ["gemini-3.5-flash", "gemini-3-flash-preview"].includes(id) ? ["minimal", ...basic] :
      id === "glm-5.2" ? ["off", "high", "max"] : undefined
    if (levels) return { levels, control: "droid-effort", runtimeRequired: true }
  }
  if (agent === "pi" && piModelIdentity(model)) {
    return { levels: ["off", "minimal", ...extended], control: "pi-thinking", runtimeRequired: true }
  }
  if (agent === "gemini") {
    if (model === "gemini-2.5-flash") return { levels: ["off"], budget: { min: 1, max: 24576 }, control: "gemini-config", runtimeRequired: true }
    if (model === "gemini-2.5-pro") return { levels: [], budget: { min: 128, max: 32768 }, control: "gemini-config", runtimeRequired: true }
    if (["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-4-argon"].includes(model)) return { levels: basic, control: "gemini-config", runtimeRequired: true }
    if (["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3-flash-preview"].includes(model)) return { levels: ["minimal", ...basic], control: "gemini-config", runtimeRequired: true }
  }
  if (agent === "eliza") return { levels: [], reason: "Eliza uses scripted replies, not a reasoning model. Thinking does not apply." }
  if (agent === "kimi") {
    // K2.5/K2.6's public API has an on/off switch, not low/high effort levels.
    // The CLI's forced-effort env bypasses its registry: never expose arbitrary
    // levels or infer that other Kimi model families accept the same controls.
    if (["kimi-k2.5", "kimi-k2.6"].includes(model)) return { levels: ["on", "off"], control: "kimi-env", runtimeRequired: true }
    if (["kimi-k2.7-code", "kimi-k2.7-code-highspeed"].includes(model)) return { levels: [], reason: "This model always uses thinking and does not offer adjustable effort. Default keeps thinking enabled." }
    if (model === "kimi-k3") return { levels: [], reason: "K3 effort controls require a compatible CLI request format. This integration has not been verified yet; no override is available." }
    return { levels: [], reason: "Thinking controls have not been verified for this Kimi model. Use Default." }
  }
  if (agent === "goose") return { levels: [], reason: "Goose retains thinking settings when resuming a session; returning to Default is not yet reliable. Custom levels are unavailable until that is resolved." }
  return unknown
}

/** Expected request contract. Runtime-required levels are not advertised choices. */
export function getThinkingCapability(agent: string, model?: string): ThinkingCapability {
  const capability = expectedThinkingCapability(agent, model)
  const noControls = agent === "eliza" || agent === "kimi" && ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"].includes(model ?? "")
  return {
    ...capability,
    status: noControls ? "no_controls" : capability.runtimeRequired || !capability.levels.length && !capability.budget ? "unverified" : "available",
    provenance: { source: "policy", evidence: "SDK expected agent/model contract; not a live model or account check." },
  }
}

/**
 * Browser-safe, version-scoped evidence for choosing before a sandbox exists.
 * This is a recorded observation, not a cache of this user's account/config.
 * The launcher always checks the actual runtime again for explicit selections.
 */
export function getVerifiedThinkingCapability(agent: string, model?: string, context: { runtimeVersion?: string; customEndpoint?: boolean } = {}): ThinkingCapability {
  const expected = getThinkingCapability(agent, model)
  if (context.customEndpoint || !model || model.startsWith("endpoint:") || model.startsWith("custom/")) {
    return { levels: [], status: "unverified", reason: "Thinking has not been verified for this endpoint. Use Default." }
  }
  const recorded: Record<string, { version: string; levels: readonly ThinkingLevel[]; evidence: string }> = {
    "codex:gpt-6.1-sol": { version: "0.159.3", levels: [...extended, "ultra"], evidence: "2026-10-16 native models cache client_version 0.159.3 lists these exact-model levels; not current account entitlement. Earlier real-provider resumed low/high/default only." },
    "codex:gpt-6-astra": { version: "0.159.3", levels: [...extended, "ultra"], evidence: "2026-10-16 native models cache client_version 0.159.3 lists these exact-model levels; not current account entitlement or provider execution." },
    "codex:gpt-6-sol": { version: "0.159.3", levels: [...extended, "ultra"], evidence: "2026-10-16 native models cache client_version 0.159.3 lists these exact-model levels; not current account entitlement or provider execution." },
    "codex:gpt-6-luna": { version: "0.159.3", levels: extended, evidence: "2026-10-16 native models cache client_version 0.159.3 lists these exact-model levels; not current account entitlement or provider execution." },
    "opencode:opencode/longcat-2.5-preview-free": { version: "1.18.33", levels: basic, evidence: "2026-10-15 OpenCode exact-model native catalog; resumed low/high/default exports and real free-provider replies." },
    "opencode:opencode/big-pickle": { version: "1.18.33", levels: [], evidence: "2026-10-16 OpenCode exact-model catalog entry: reasoning supported, variants empty." },
    "opencode:opencode/nemotron-3-ultra-free": { version: "1.18.33", levels: [], evidence: "2026-10-16 OpenCode exact-model catalog entry: reasoning supported, variants empty." },
    "kimi:kimi-k2.5": { version: "2.1.1", levels: ["on", "off"], evidence: "2026-10-16 native CLI wire tests with controlled provider: on/off/default on resumed sessions; not Moonshot acceptance." },
    "kimi:kimi-k2.6": { version: "2.1.1", levels: ["on", "off"], evidence: "2026-10-16 native CLI wire tests with controlled provider: on/off/default on resumed sessions; not Moonshot acceptance." },
  }
  const entry = recorded[`${agent}:${model}`]
  if (!entry || context.runtimeVersion && context.runtimeVersion !== entry.version) {
    return { ...expected, levels: [], budget: undefined, status: expected.status === "no_controls" ? "no_controls" : "unverified", reason: expected.reason ?? "No verified thinking catalog is available for this model/runtime. Check the sandbox or use Default." }
  }
  return {
    ...expected, levels: entry.levels, budget: undefined,
    status: entry.levels.length ? "available" : "no_controls", runtimeVersion: entry.version,
    provenance: { source: "verified_catalog", evidence: entry.evidence, runtimeVersion: entry.version },
    reason: entry.levels.length ? undefined : "The recorded native catalog has no adjustable thinking levels for this model. Default keeps the model's own behavior.",
  }
}

export function supportsThinking(capability: ThinkingCapability, value: string): value is ThinkingLevel {
  if (value === "default" || capability.levels.some(level => level === value)) return true
  if (capability.budget && /^budget:(?:0|[1-9]\d{0,6})$/.test(value)) {
    const budget = Number(value.slice(7))
    return budget >= capability.budget.min && budget <= capability.budget.max
  }
  return false
}

/** Catalog variants are opaque names, not universally equivalent effort levels. */
export function variantChoice(value: string): ThinkingLevel | undefined {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value) || value === "default") return undefined
  return THINKING_LEVELS.some(level => level === value) ? value as ThinkingLevel : `variant:${value}`
}

export function thinkingLabel(value: string): string {
  if (value.startsWith("budget:")) return `${value.slice(7)} thinking tokens`
  if (value.startsWith("variant:")) return value.slice(8)
  return value === "xhigh" ? "Extra high" : value[0].toUpperCase() + value.slice(1)
}

export class UnsupportedThinkingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedThinkingError"
  }
}

/** Default requests the runtime's default; it is never an alias for medium. */
export function validateThinking(agent: string, model: string | undefined, value: unknown): ThinkingLevel {
  if (value === undefined || value === null || value === "default") return "default"
  const capability = getThinkingCapability(agent, model)
  const dynamicVariant = typeof value === "string" && ["opencode-variant", "kilo-variant"].includes(capability.control ?? "") &&
    value.startsWith("variant:") && variantChoice(value.slice(8)) === value
  if (typeof value !== "string" || !supportsThinking(capability, value) && !dynamicVariant) {
    throw new UnsupportedThinkingError(`Thinking ${typeof value === "string" ? JSON.stringify(value.slice(0, 50)) : "value"} is not supported for ${agent}/${model ?? "default model"}. Choose Default or a supported level.`)
  }
  return value as ThinkingLevel
}

export function thinkingArgs(agent: string, model: string | undefined, value: unknown): string[] {
  const level = validateThinking(agent, model, value)
  if (level === "default") return []
  switch (getThinkingCapability(agent, model).control) {
    case "codex-config": return ["-c", `model_reasoning_effort=${JSON.stringify(level)}`]
    case "claude-effort": return ["--effort", level]
    case "commandcode-effort": return ["--effort", level]
    case "copilot-effort":
    case "droid-effort": return ["--reasoning-effort", level]
    case "pi-thinking": return ["--thinking", level]
    case "opencode-variant":
    case "kilo-variant": return ["--variant", level.startsWith("variant:") ? level.slice(8) : level]
    default: return [] // validateThinking rejects unknown combinations above.
  }
}
