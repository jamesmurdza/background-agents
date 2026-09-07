/**
 * Unit tests for the agent readiness/status logic behind the picker dot:
 * agentSharedPoolExhausted plus its effect on agentHasFreeUsage / agentIsReady.
 *
 * Pure functions — no mocks. The interesting case is the daily balance
 * allowance running out: the picker should show a red ("exhausted") dot, not
 * green — and it must do so for every shared pool, since the balance is pooled.
 */
import { describe, it, expect } from "vitest"
import {
  agentSharedPoolExhausted,
  agentUsesSharedPool,
  sharedPoolProviderForModel,
  formatTokenRate,
  agentModels,
  agentHasFreeUsage,
  agentIsReady,
  hasCredentialsForModel,
  getFreeModelForAgent,
  modelRequiresKey,
  getAgentModels,
  resolveChatModel,
  type CredentialFlags,
} from "@background-agents/common"
import { creditTier } from "./server/credits"

const sharedPoolFresh: CredentialFlags = { CLAUDE_SHARED_POOL_AVAILABLE: true }
const sharedPoolUsedUp: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  SHARED_BALANCE_EXHAUSTED: true,
}
const ownKeyButLimit: CredentialFlags = {
  CLAUDE_SHARED_POOL_AVAILABLE: true,
  SHARED_BALANCE_EXHAUSTED: true,
  ANTHROPIC_API_KEY: true,
}

describe("agentSharedPoolExhausted", () => {
  it("is true when the Claude shared pool is used up and there's no own key", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolUsedUp)).toBe(true)
  })

  it("is false when the shared pool still has budget", () => {
    expect(agentSharedPoolExhausted("claude-code", sharedPoolFresh)).toBe(false)
  })

  it("is false when the user has their own Anthropic key to fall back on", () => {
    expect(agentSharedPoolExhausted("claude-code", ownKeyButLimit)).toBe(false)
  })

  it("is false for agents with no shared pool at all", () => {
    // Kilo's free tier isn't a shared pool, so a spent balance doesn't touch it.
    expect(agentSharedPoolExhausted("kilo", sharedPoolUsedUp)).toBe(false)
    expect(agentSharedPoolExhausted("codex", sharedPoolUsedUp)).toBe(false)
  })

  it("closes the OpenCode and Gemini pools too, because the balance is pooled", () => {
    const allSharedSpent: CredentialFlags = {
      SHARED_BALANCE_EXHAUSTED: true,
      OPENCODE_API_KEY_SHARED: true,
      GEMINI_API_KEY_SHARED: true,
    }
    expect(agentSharedPoolExhausted("opencode", allSharedSpent)).toBe(true)
    expect(agentSharedPoolExhausted("gemini", allSharedSpent)).toBe(true)
  })

  it("leaves a pool open when the user brought their own key for it", () => {
    const ownOpencodeKey: CredentialFlags = {
      SHARED_BALANCE_EXHAUSTED: true,
      OPENCODE_API_KEY_USER: true,
    }
    expect(agentSharedPoolExhausted("opencode", ownOpencodeKey)).toBe(false)
  })
})

describe("the yellow dot: a shared pool the balance is nearly out for", () => {
  // getAgentStatus paints yellow on `agentUsesSharedPool(agent, flags) &&
  // creditTier(balance) === "low"`. Red comes from the flag above instead, so
  // these two together are the whole colour decision — this pins the half that
  // the balance drives.
  it("applies to every shared pool, since the balance is pooled", () => {
    const allShared: CredentialFlags = {
      CLAUDE_SHARED_POOL_AVAILABLE: true,
      OPENCODE_API_KEY_SHARED: true,
      GEMINI_API_KEY_SHARED: true,
    }
    expect(creditTier(0.05)).toBe("low")
    for (const agent of ["claude-code", "opencode", "gemini"] as const) {
      expect(agentUsesSharedPool(agent, allShared)).toBe(true)
    }
  })

  it("does not apply to an agent running on the user's own key", () => {
    // Their spend never touches the balance, so a low balance says nothing
    // about their next send and the dot must stay green.
    const ownOpencodeKey: CredentialFlags = { OPENCODE_API_KEY_USER: true }
    expect(agentUsesSharedPool("opencode", ownOpencodeKey)).toBe(false)
    expect(agentIsReady("opencode", { OPENCODE_API_KEY: true })).toBe(true)
  })

  it("does not apply to an agent with no shared pool at all", () => {
    expect(agentUsesSharedPool("codex", { CLAUDE_SHARED_POOL_AVAILABLE: true })).toBe(false)
  })

  it("hands over to red at exactly the balance the server refuses", () => {
    // The tier flips to "empty" at zero, which is where SHARED_BALANCE_EXHAUSTED
    // is set too — so there is no balance that is both yellow here and refused
    // there.
    expect(creditTier(0.000001)).toBe("low")
    expect(creditTier(0)).toBe("empty")
  })
})

describe("readiness when the balance runs out", () => {
  it("no longer reports free usage (so the dot won't be green)", () => {
    expect(agentHasFreeUsage("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentHasFreeUsage("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("is not 'ready' when exhausted with no fallback credential", () => {
    expect(agentIsReady("claude-code", sharedPoolFresh)).toBe(true)
    expect(agentIsReady("claude-code", sharedPoolUsedUp)).toBe(false)
  })

  it("stays ready when the user has their own key despite the limit", () => {
    expect(agentIsReady("claude-code", ownKeyButLimit)).toBe(true)
  })
})

describe("shared Claude pool does not leak to non-claude-code agents", () => {
  // The shared pool / subscription token is only injected server-side for
  // claude-code (see resolveSendCredentials), so other agents' Claude models
  // must require a real ANTHROPIC_API_KEY — otherwise the picker shows a green
  // "ready" dot for an agent that would actually fail to run.
  const anthropicModel = { value: "claude-sonnet-4-5", label: "Sonnet", requiresKey: "anthropic" as const }

  it("does not treat goose as ready off the shared Claude pool alone", () => {
    expect(agentIsReady("goose", sharedPoolFresh)).toBe(false)
    expect(hasCredentialsForModel(anthropicModel, sharedPoolFresh, "goose")).toBe(false)
  })

  it("treats goose as ready once the user has their own Anthropic key", () => {
    expect(hasCredentialsForModel(anthropicModel, { ANTHROPIC_API_KEY: true }, "goose")).toBe(true)
    expect(agentIsReady("goose", { ANTHROPIC_API_KEY: true })).toBe(true)
  })

  it("still lets claude-code use the shared pool", () => {
    expect(hasCredentialsForModel(anthropicModel, sharedPoolFresh, "claude-code")).toBe(true)
  })
})

describe("shared Gemini pool unlocks Flash but not Pro", () => {
  // The server-shared Gemini key backs only the cheaper Flash tier for free
  // usage; Pro-tier Gemini models must stay locked until the user adds their
  // own key. This holds across every agent that exposes a Gemini model.
  const geminiShared: CredentialFlags = { GEMINI_API_KEY: true, GEMINI_API_KEY_SHARED: true }
  const geminiOwnKey: CredentialFlags = {
    GEMINI_API_KEY: true,
    GEMINI_API_KEY_USER: true,
  }
  const flash = { value: "gemini-2.5-flash", label: "Flash", requiresKey: "gemini" as const }
  const pro = { value: "gemini-3.1-pro-preview", label: "Pro", requiresKey: "gemini" as const }
  const piPro = { value: "google/gemini-3.1-pro-preview", label: "Pro", requiresKey: "gemini" as const }

  it("allows Flash models on the shared pool", () => {
    expect(hasCredentialsForModel(flash, geminiShared, "gemini")).toBe(true)
  })

  it("blocks Pro models on the shared pool across agents", () => {
    expect(hasCredentialsForModel(pro, geminiShared, "gemini")).toBe(false)
    expect(hasCredentialsForModel(pro, geminiShared, "droid")).toBe(false)
    expect(hasCredentialsForModel(piPro, geminiShared, "pi")).toBe(false)
  })

  it("unlocks Pro once the user brings their own Gemini key", () => {
    expect(hasCredentialsForModel(pro, geminiOwnKey, "gemini")).toBe(true)
    expect(hasCredentialsForModel(piPro, geminiOwnKey, "pi")).toBe(true)
  })
})

describe("shared Claude pool does not unlock BYOK-only models (Fable)", () => {
  // Fable is back in the claude-code picker but excluded from the shared pool
  // (SHARED_CLAUDE_POOL_EXCLUDED_MODELS): it runs only on the user's own key or
  // subscription. The other claude-code models stay available on the shared pool.
  const fable = { value: "fable", label: "Fable", requiresKey: "anthropic" as const }
  const sonnet = { value: "sonnet", label: "Sonnet", requiresKey: "anthropic" as const }

  it("blocks Fable on the shared pool alone", () => {
    expect(hasCredentialsForModel(fable, sharedPoolFresh, "claude-code")).toBe(false)
  })

  it("still allows the regular Sonnet model on the shared pool", () => {
    expect(hasCredentialsForModel(sonnet, sharedPoolFresh, "claude-code")).toBe(true)
  })

  it("unlocks Fable with the user's own Anthropic key", () => {
    expect(hasCredentialsForModel(fable, { ANTHROPIC_API_KEY: true }, "claude-code")).toBe(true)
  })

  it("unlocks Fable with the user's pasted subscription token", () => {
    expect(hasCredentialsForModel(fable, { CLAUDE_CODE_CREDENTIALS: true }, "claude-code")).toBe(true)
  })
})

describe("resolveChatModel downgrades locked/removed stored models", () => {
  // An existing chat carries its own stored model. If the user can't run it
  // (locked BYOK-only model, or a model since removed from the picker), the chat
  // should fall back to a usable default instead of stranding on a lock.
  it("downgrades an existing Fable chat to Sonnet when there's no key", () => {
    expect(resolveChatModel("claude-code", "fable", sharedPoolFresh)).toBe("sonnet")
  })

  it("keeps Fable when the user has their own Anthropic key", () => {
    expect(resolveChatModel("claude-code", "fable", { ANTHROPIC_API_KEY: true })).toBe("fable")
  })

  it("keeps a normal, usable stored model as-is", () => {
    expect(resolveChatModel("claude-code", "sonnet", sharedPoolFresh)).toBe("sonnet")
  })

  it("downgrades a model no longer offered by the agent", () => {
    expect(resolveChatModel("claude-code", "some-removed-model", sharedPoolFresh)).toBe("sonnet")
  })

  it("falls back to the default when the chat has no stored model", () => {
    expect(resolveChatModel("claude-code", null, sharedPoolFresh)).toBe("sonnet")
  })
})

describe("free models survive a spent balance", () => {
  // The escape hatch: with the balance gone, OpenCode's free tier is what a
  // user is told to switch to. Two separate gates have to agree on that — the
  // picker (hasCredentialsForModel) and the send path (checkSharedPoolUsage,
  // which keys on modelRequiresKey). If they drift, the UI offers a model the
  // server then 429s, and "Continue with OpenCode" loops.
  const spentWithSharedOpencode: CredentialFlags = {
    SHARED_BALANCE_EXHAUSTED: true,
    OPENCODE_API_KEY: true,
    OPENCODE_API_KEY_SHARED: true,
  }

  const freeModels = getAgentModels("opencode").filter(
    (m) => m.requiresKey === "none"
  )

  it("has free OpenCode models to fall back to", () => {
    expect(freeModels.length).toBeGreaterThan(0)
    expect(getFreeModelForAgent("opencode")).toBe(freeModels[0].value)
  })

  it("keeps every free model selectable in the picker", () => {
    for (const m of freeModels) {
      expect(hasCredentialsForModel(m, spentWithSharedOpencode, "opencode")).toBe(true)
    }
  })

  it("marks them as needing no key, which is what the send path checks", () => {
    for (const m of freeModels) {
      expect(modelRequiresKey("opencode", m.value)).toBe("none")
    }
  })

  it("still blocks the paid shared models", () => {
    const paid = { value: "opencode-go/mimo-v2.5-pro", label: "MiMo", requiresKey: "opencode" as const }
    expect(hasCredentialsForModel(paid, spentWithSharedOpencode, "opencode")).toBe(false)
    expect(modelRequiresKey("opencode", paid.value)).toBe("opencode")
  })

  // The picker dot (AgentModelSelector.getAgentStatus) paints red only when
  // agentSharedPoolExhausted is true AND the agent has no always-free model to
  // fall back to. OpenCode always has one, so its dot must stay green even
  // though the metered shared pool itself is correctly reported as exhausted.
  it("keeps agentSharedPoolExhausted true (the metered pool really is closed)", () => {
    expect(agentSharedPoolExhausted("opencode", spentWithSharedOpencode)).toBe(true)
  })

  it("still reports free usage and readiness despite the exhausted metered pool", () => {
    expect(agentHasFreeUsage("opencode", spentWithSharedOpencode)).toBe(true)
    expect(agentIsReady("opencode", spentWithSharedOpencode)).toBe(true)
  })

  it("reports free usage even with no credentials at all, since the free tier needs none", () => {
    expect(agentHasFreeUsage("opencode", {})).toBe(true)
    expect(agentIsReady("opencode", {})).toBe(true)
  })
})

/**
 * The price the model picker prints: the list rate divided by the pool's
 * discount, so it reads as what the turn actually costs the user in credits.
 */
describe("shared-pool model pricing", () => {
  const sharedAll: CredentialFlags = {
    CLAUDE_SHARED_POOL_AVAILABLE: true,
    OPENCODE_API_KEY_SHARED: true,
    GEMINI_API_KEY_SHARED: true,
  }

  it("names the pool a shared run draws on", () => {
    expect(sharedPoolProviderForModel("claude-code", "sonnet", sharedAll)).toBe("claude")
    expect(sharedPoolProviderForModel("opencode", "opencode-go/glm-5.1", sharedAll)).toBe("opencode")
    // Pi has no pool of its own, but its Flash model runs on the shared Gemini key.
    expect(sharedPoolProviderForModel("pi", "google/gemini-2.5-flash", sharedAll)).toBe("gemini")
  })

  it("is null where no shared key serves the model, so it stays at list value", () => {
    // Own key; Fable is BYOK-only; Zen is outside the Go key; Pro is BYOK-only.
    expect(sharedPoolProviderForModel("claude-code", "sonnet", { ANTHROPIC_API_KEY: true })).toBeNull()
    expect(sharedPoolProviderForModel("claude-code", "fable", sharedAll)).toBeNull()
    expect(sharedPoolProviderForModel("opencode", "opencode/glm-5.1", sharedAll)).toBeNull()
    expect(sharedPoolProviderForModel("gemini", "gemini-3.1-pro-preview", sharedAll)).toBeNull()
  })

  it("formats a rate the way the picker shows it", () => {
    const sonnet = agentModels["claude-code"].find((m) => m.value === "sonnet")!.priceUsdPerM!
    expect(formatTokenRate(sonnet)).toBe("$2/M")
    expect(formatTokenRate(sonnet / 20)).toBe("10¢/M") // the shared Claude pool
    expect(formatTokenRate(0)).toBe("FREE")
  })
})
