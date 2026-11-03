/**
 * Agent model catalog
 *
 * The model lists below churn independently of the resolution/credential
 * logic in agents.ts — they get updated whenever a vendor ships a new model
 * or retires an old one (see e.g. the "sync agent model catalogs with vendor
 * docs" commits), without touching how a model gets picked or gated. Keeping
 * that data in its own module keeps those diffs from mixing with logic
 * changes in agents.ts.
 */

import type { Agent, ProviderId } from "./agents"

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
export const SHARED_OPENCODE_ALLOWED = new Set<string>([
  "opencode-go/glm-5.2",
  "opencode-go/glm-5.3",
  "opencode-go/kimi-k2.6",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/mimo-v2.5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m3",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.7-plus",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4.1-flash",
  "opencode-go/kimi-k3.1-pro",
])

/**
 * Pro-tier Gemini models (requiresKey "gemini") that the server-shared Gemini
 * pool must NOT unlock, across every agent that exposes them (Gemini, Pi,
 * Droid). The shared key backs only the cheaper Flash tier for free usage;
 * running Pro requires the user's own stored GEMINI_API_KEY. New Flash models
 * stay available by default — only the ids listed here are gated.
 */
export const SHARED_GEMINI_POOL_PRO_MODELS = new Set<string>([
  "gemini-3.1-pro-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-4-argon",
])

/**
 * Claude Code models the server-shared Claude pool must NOT unlock. Unlike every
 * other anthropic model on claude-code, these run only on the user's OWN key or
 * subscription token — never the free shared pool. Fable ($10/M) is too costly to
 * serve for free, so it's BYOK-only. This also retroactively gates existing chats
 * still pointed at such a model: with no personal Anthropic credential the picker
 * shows a lock and the send path (hasRequiredCredentials) blocks the turn.
 */
export const SHARED_CLAUDE_POOL_EXCLUDED_MODELS = new Set<string>(["fable"])

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
    { value: "opencode/mimo-v2.6-flash-free", label: "MiMo v2.6 Flash", requiresKey: "none", priceUsdPerM: 0 },
    // Curated OpenCode Go models (opencode-go/ prefix), runnable on the
    // server-shared Go subscription key. Shown first when OPENCODE_API_KEY is
    // available. These route through Go, not Zen — see SHARED_OPENCODE_ALLOWED.
    // priceUsdPerM is the input $/M-token rate from OpenCode's published Go rate card.
    { value: "opencode-go/glm-5.2", label: "GLM-5.2", requiresKey: "opencode", priceUsdPerM: 1.4 },
    { value: "opencode-go/glm-5.3", label: "GLM-5.3", requiresKey: "opencode", priceUsdPerM: 1.4 },
    { value: "opencode-go/kimi-k3.1-pro", label: "Kimi K3.1 Pro", requiresKey: "opencode", priceUsdPerM: 3 },
    { value: "opencode-go/kimi-k3", label: "Kimi K3", requiresKey: "opencode", priceUsdPerM: 3 },
    { value: "opencode-go/kimi-k2.6", label: "Kimi K2.6", requiresKey: "opencode", priceUsdPerM: 0.95 },
    { value: "opencode-go/kimi-k2.7-code", label: "Kimi K2.7 Code", requiresKey: "opencode", priceUsdPerM: 0.95 },
    { value: "opencode-go/mimo-v2.5", label: "MiMo v2.5", requiresKey: "opencode", priceUsdPerM: 0.14 },
    { value: "opencode-go/mimo-v2.5-pro", label: "MiMo v2.5 Pro", requiresKey: "opencode", priceUsdPerM: 0.44 },
    { value: "opencode-go/minimax-m2.7", label: "MiniMax M2.7", requiresKey: "opencode", priceUsdPerM: 0.3 },
    { value: "opencode-go/minimax-m3", label: "MiniMax M3", requiresKey: "opencode", priceUsdPerM: 0.3 },
    { value: "opencode-go/qwen3.6-plus", label: "Qwen3.6 Plus", requiresKey: "opencode", priceUsdPerM: 0.5 },
    { value: "opencode-go/qwen3.8-max", label: "Qwen3.8 Max", requiresKey: "opencode", priceUsdPerM: 2 },
    { value: "opencode-go/qwen3.7-max", label: "Qwen3.7 Max", requiresKey: "opencode", priceUsdPerM: 2.5 },
    { value: "opencode-go/qwen3.7-plus", label: "Qwen3.7 Plus", requiresKey: "opencode", priceUsdPerM: 0.4 },
    { value: "opencode-go/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "opencode", priceUsdPerM: 0.66 },
    { value: "opencode-go/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", requiresKey: "opencode", priceUsdPerM: 0.22 },

    // Remaining paid models — route through OpenCode Zen (pay-as-you-go credits).
    // Preserve original order, excluding duplicates.
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "opencode" },
    { value: "opencode/claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "opencode" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-haiku-5-5", label: "Claude Haiku 5.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "opencode" },
    { value: "opencode/claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "opencode" },
    { value: "opencode/claude-opus-5", label: "Claude Opus 5", requiresKey: "opencode" },
    { value: "opencode/claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "opencode" },
    { value: "opencode/claude-fable-5", label: "Claude Fable 5", requiresKey: "opencode" },
    { value: "opencode/claude-fable-5-1", label: "Claude Fable 5.1", requiresKey: "opencode" },
    { value: "opencode/gpt-5", label: "GPT-5", requiresKey: "opencode" },
    { value: "opencode/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "opencode" },
    // gpt-5.4 retired platform-wide Aug 31, 2026 (replaced by gpt-6-sol) — unlike
    // gpt-5.5, whose retirement is scoped to ChatGPT sign-in only, so it stays.
    { value: "opencode/gpt-5.5", label: "GPT-5.5", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-sol", label: "GPT-5.6 Sol", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-terra", label: "GPT-5.6 Terra", requiresKey: "opencode" },
    { value: "opencode/gpt-5.6-luna", label: "GPT-5.6 Luna", requiresKey: "opencode" },
    { value: "opencode/gpt-6-astra", label: "GPT-6 Astra", requiresKey: "opencode" },
    { value: "opencode/gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "opencode" },
    { value: "opencode/gemini-3-flash", label: "Gemini 3 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.5-flash", label: "Gemini 3.5 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "opencode" },
    { value: "opencode/gemini-3.1-pro", label: "Gemini 3.1 Pro", requiresKey: "opencode" },
    { value: "opencode/gemini-4-argon", label: "Gemini 4 Argon", requiresKey: "opencode" },
    // Anthropic direct models — route to Anthropic on the user's own Anthropic key
    { value: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "anthropic" },
    { value: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-haiku-5-5", label: "Claude Haiku 5.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-5", label: "Claude Opus 5", requiresKey: "anthropic" },
    { value: "anthropic/claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "anthropic" },
    { value: "anthropic/claude-fable-5", label: "Claude Fable 5", requiresKey: "anthropic" },
    { value: "anthropic/claude-fable-5-1", label: "Claude Fable 5.1", requiresKey: "anthropic" },
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
    { value: "openai/gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5-nano", label: "GPT-5 Nano", requiresKey: "openai" },
    { value: "openai/gpt-5-pro", label: "GPT-5 Pro", requiresKey: "openai" },
    { value: "openai/gpt-5.1", label: "GPT-5.1", requiresKey: "openai" },
    { value: "openai/gpt-5.2", label: "GPT-5.2", requiresKey: "openai" },
    { value: "openai/gpt-6-astra", label: "GPT-6 Astra", requiresKey: "openai" },
    { value: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "openai" },
    { value: "openai/o1", label: "o1", requiresKey: "openai" },
    { value: "openai/o1-pro", label: "o1 Pro", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/o3-pro", label: "o3 Pro", requiresKey: "openai" },
    { value: "openai/o4-mini", label: "o4 Mini", requiresKey: "openai" },
  ],
  "command-code": [
    // Command Code's own catalog, routed through the user's Command Code plan
    // on COMMAND_CODE_API_KEY. Ids are the catalog's EXACT ids (the CLI rejects
    // anything else). No priceUsdPerM: usage bills against the user's own
    // Command Code plan, not ours, so the picker shows no price.
    //
    // Every model needs the one key: print mode refuses to start without a
    // Command Code credential, even for BYOK providers, so there is no
    // requiresKey: "none" tier here. The `Min plan` column of the catalog also
    // gates these — the open models below are the widest-available tier, which
    // is why they lead and why the default model is one of them.
    //
    // ── Open models ──
    { value: "xiaomi/mimo-v2.6-pro", label: "MiMo v2.6 Pro", requiresKey: "commandcode" },
    { value: "xiaomi/mimo-v2.6-flash", label: "MiMo v2.6 Flash", requiresKey: "commandcode" },
    { value: "zai-org/GLM-5.3", label: "GLM-5.3", requiresKey: "commandcode" },
    { value: "z-ai/glm-5.3-flash", label: "GLM-5.3 Flash", requiresKey: "commandcode" },
    { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "commandcode" },
    { value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", requiresKey: "commandcode" },
    { value: "moonshotai/Kimi-K3.1-Pro", label: "Kimi K3.1 Pro", requiresKey: "commandcode" },
    { value: "moonshotai/Kimi-K3", label: "Kimi K3", requiresKey: "commandcode" },
    { value: "moonshotai/Kimi-K2.7-Code", label: "Kimi K2.7 Code", requiresKey: "commandcode" },
    { value: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3", requiresKey: "commandcode" },
    { value: "Qwen/Qwen3.8-Max", label: "Qwen 3.8 Max", requiresKey: "commandcode" },
    { value: "Qwen/Qwen3.8-Flash", label: "Qwen 3.8 Flash", requiresKey: "commandcode" },
    { value: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra", requiresKey: "commandcode" },
    { value: "poolside/laguna-s-2.1-free", label: "Laguna S 2.1", requiresKey: "commandcode" },
    // ── Anthropic (Pro plan and above) ──
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "commandcode" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "commandcode" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "commandcode" },
    { value: "claude-fable-5-1", label: "Claude Fable 5.1", requiresKey: "commandcode" },
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", requiresKey: "commandcode" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "commandcode" },
    // ── OpenAI (Pro plan and above) ──
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "commandcode" },
    { value: "gpt-6-astra", label: "GPT-6 Astra", requiresKey: "commandcode" },
    { value: "gpt-6-sol", label: "GPT-6 Sol", requiresKey: "commandcode" },
    { value: "gpt-6-luna", label: "GPT-6 Luna", requiresKey: "commandcode" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "commandcode" },
    // ── Google (Pro plan and above) ──
    { value: "google/gemini-4-argon", label: "Gemini 4 Argon", requiresKey: "commandcode" },
    { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "commandcode" },
    { value: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", requiresKey: "commandcode" },
  ],
  "codex": [
    // GPT-5.5 retired from Codex/ChatGPT sign-in (Oct 14, 2026) — see
    // https://developers.openai.com/codex/models. GPT-6 Sol/Luna/Astra and
    // GPT-6.1 Sol/Terra are the current generation.
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "openai" },
    { value: "gpt-6.1-terra", label: "GPT-6.1 Terra", requiresKey: "openai" },
    { value: "gpt-6-astra", label: "GPT-6 Astra", requiresKey: "openai" },
    { value: "gpt-6-sol", label: "GPT-6 Sol", requiresKey: "openai" },
    { value: "gpt-6-luna", label: "GPT-6 Luna", requiresKey: "openai" },
    { value: "gpt-5.5", label: "GPT-5.5 (API key only)", requiresKey: "openai" },
  ],
  "copilot": [
    { value: "auto", label: "Auto", requiresKey: "github" },
    { value: "claude-fable-5.1", label: "Claude Fable 5.1", requiresKey: "github" },
    { value: "claude-fable-5", label: "Claude Fable 5", requiresKey: "github" },
    { value: "claude-sonnet-5.5", label: "Claude Sonnet 5.5", requiresKey: "github" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "github" },
    { value: "claude-opus-5.5", label: "Claude Opus 5.5", requiresKey: "github" },
    { value: "claude-opus-5", label: "Claude Opus 5", requiresKey: "github" },
    { value: "claude-opus-4.8", label: "Claude Opus 4.8", requiresKey: "github" },
    { value: "claude-haiku-5.5", label: "Claude Haiku 5.5", requiresKey: "github" },
    { value: "claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "github" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "github" },
    { value: "gpt-6.1-terra", label: "GPT-6.1 Terra", requiresKey: "github" },
    { value: "gpt-6-astra", label: "GPT-6 Astra", requiresKey: "github" },
    { value: "gpt-6-sol", label: "GPT-6 Sol", requiresKey: "github" },
    { value: "gpt-6-luna", label: "GPT-6 Luna", requiresKey: "github" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", requiresKey: "github" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", requiresKey: "github" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", requiresKey: "github" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", requiresKey: "github" },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "github" },
    { value: "gemini-4-argon", label: "Gemini 4 Argon", requiresKey: "github" },
    { value: "mai-code-1.1-flash", label: "MAI-Code 1.1 Flash", requiresKey: "github" },
    { value: "kimi-k3", label: "Kimi K3", requiresKey: "github" },
    { value: "grok-4.7", label: "Grok 4.7", requiresKey: "github" },
    { value: "grok-4.6", label: "Grok 4.6", requiresKey: "github" },
    { value: "grok-4.5", label: "Grok 4.5", requiresKey: "github" },
  ],
  "gemini": [
    // Default first, then Flash tier (newest → oldest), then Pro.
    // Flash-tier priceUsdPerM is the input $/M rate — these run on the shared
    // Gemini pool (see SHARED_GEMINI_POOL_PRO_MODELS). Pro is BYOK-only, so it
    // gets no label — its cost isn't drawn from our shared key.
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "gemini", priceUsdPerM: 0.75 },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", requiresKey: "gemini", priceUsdPerM: 1.5 },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", requiresKey: "gemini", priceUsdPerM: 0.5 },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
  ],
  "goose": [
    { value: "gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", requiresKey: "openai" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "openai" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "anthropic" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "anthropic" },
  ],
  "kilo": [
    // Auto-routers
    { value: "kilo/kilo-auto/free", label: "Auto Free", requiresKey: "none", priceUsdPerM: 0 },
    { value: "kilo/kilo-auto/frontier", label: "Auto Frontier", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/balanced", label: "Auto Balanced", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/efficient", label: "Auto Efficient", requiresKey: "kilo" },
    { value: "kilo/kilo-auto/small", label: "Auto Small", requiresKey: "kilo" },
    // Free models
    { value: "kilo/nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra", requiresKey: "none", priceUsdPerM: 0 },
    // Anthropic via Kilo gateway
    { value: "kilo/anthropic/claude-opus-5.5", label: "Claude Opus 5.5", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-fable-5", label: "Claude Fable 5", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-opus-4.8", label: "Claude Opus 4.8", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-opus-4.7", label: "Claude Opus 4.7", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", requiresKey: "kilo" },
    { value: "kilo/anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", requiresKey: "kilo" },
    // OpenAI via Kilo gateway
    { value: "kilo/openai/gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "kilo" },
    // gpt-5.4 retired platform-wide Aug 31, 2026 (replaced by gpt-6-sol) — unlike
    // gpt-5.5, whose retirement is scoped to ChatGPT sign-in only, so it stays.
    { value: "kilo/openai/gpt-5.5", label: "GPT-5.5", requiresKey: "kilo" },
    // Google via Kilo gateway
    { value: "kilo/google/gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "kilo" },
    { value: "kilo/google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-pro", label: "Gemini 2.5 Pro", requiresKey: "kilo" },
    { value: "kilo/google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "kilo" },
    // DeepSeek via Kilo gateway
    { value: "kilo/deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", requiresKey: "kilo" },
    // Other notable models
    { value: "kilo/moonshotai/kimi-k3", label: "Kimi K3", requiresKey: "kilo" },
    { value: "kilo/moonshotai/kimi-k2.6", label: "Kimi K2.6", requiresKey: "kilo" },
    { value: "kilo/qwen/qwen3-coder", label: "Qwen3 Coder", requiresKey: "kilo" },
    { value: "kilo/x-ai/grok-4.6", label: "Grok 4.6", requiresKey: "kilo" },
  ],
  "kimi": [
    // Moonshot (Kimi) models, routed through the user's KIMI_API_KEY against
    // https://api.moonshot.ai/v1. Each value must match a [models."<id>"] entry
    // declared in the generated ~/.kimi-code/config.toml (see the kimi agent).
    { value: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", requiresKey: "kimi" },
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
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "anthropic" },
    { value: "claude-opus-5", label: "Claude Opus 5", requiresKey: "anthropic" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", requiresKey: "anthropic" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "anthropic" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5", requiresKey: "anthropic" },
    { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", requiresKey: "anthropic" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    // ── BYOK: OpenAI ──
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "openai" },
    { value: "gpt-5", label: "GPT-5", requiresKey: "openai" },
    { value: "gpt-5-mini", label: "GPT-5 Mini", requiresKey: "openai" },
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
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "gemini", priceUsdPerM: 0.75 },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", requiresKey: "gemini", priceUsdPerM: 1.5 },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", requiresKey: "gemini", priceUsdPerM: 0.5 },
    // ── Factory-hosted (FACTORY_API_KEY; droid's built-in catalog). There is NO
    // free/no-key tier — verified: every built-in model 401s without a Factory key.
    { value: "factory/claude-opus-5-5", label: "Claude Opus 5.5 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-fable-5-1", label: "Claude Fable 5.1 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-fable-5", label: "Claude Fable 5 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-opus-4-8", label: "Claude Opus 4.8 (Factory)", requiresKey: "factory" },
    { value: "factory/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Factory)", requiresKey: "factory" },
    { value: "factory/gpt-6-astra", label: "GPT-6 Astra (Factory)", requiresKey: "factory" },
    { value: "factory/gpt-6.1-sol", label: "GPT-6.1 Sol (Factory)", requiresKey: "factory" },
    { value: "factory/gpt-5.6-sol", label: "GPT-5.6 Sol (Factory)", requiresKey: "factory" },
    { value: "factory/gemini-3.8-flash", label: "Gemini 3.8 Flash (Factory)", requiresKey: "factory" },
    { value: "factory/gemini-3.5-flash", label: "Gemini 3.5 Flash (Factory)", requiresKey: "factory" },
    { value: "factory/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Factory)", requiresKey: "factory" },
    { value: "factory/glm-5.2", label: "GLM 5.2 (Factory)", requiresKey: "factory" },
  ],
  "pi": [
    // Anthropic models (default provider)
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5", requiresKey: "anthropic" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7", requiresKey: "anthropic" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", requiresKey: "anthropic" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", requiresKey: "anthropic" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", requiresKey: "anthropic" },
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", requiresKey: "anthropic" },
    { value: "claude-fable-5", label: "Claude Fable 5", requiresKey: "anthropic" },
    { value: "claude-fable-5-1", label: "Claude Fable 5.1", requiresKey: "anthropic" },
    // OpenAI models
    { value: "openai/gpt-4o", label: "GPT-4o", requiresKey: "openai" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", requiresKey: "openai" },
    { value: "openai/o3", label: "o3", requiresKey: "openai" },
    { value: "openai/o3-mini", label: "o3 Mini", requiresKey: "openai" },
    { value: "openai/gpt-5", label: "GPT-5", requiresKey: "openai" },
    { value: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", requiresKey: "openai" },
    // Google models — Flash also runs on the shared Gemini pool; Pro and Argon
    // are BYOK-only.
    { value: "google/gemini-4-argon", label: "Gemini 4 Argon", requiresKey: "gemini" },
    { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", requiresKey: "gemini" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", requiresKey: "gemini", priceUsdPerM: 0.3 },
    { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", requiresKey: "gemini", priceUsdPerM: 0.75 },
  ],
}

/** Default model per agent */
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "sonnet",
  "opencode": "opencode-go/mimo-v2.5-pro",
  "codex": "gpt-6.1-sol", // GPT-5.5 retired Oct 14, 2026; near-Astra quality at lower cost
  "command-code": "xiaomi/mimo-v2.6-pro", // widest plan availability of the catalog tiers
  "copilot": "gpt-5.6-terra", // GPT-5 Mini no longer offered; Terra is GitHub's recommended everyday model
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
  "command-code": true,
  "copilot": false,
  "droid": false,
  "eliza": false,
  "gemini": true,
  "goose": true,
  "kilo": false,
  "kimi": false,
  "pi": false,
}
