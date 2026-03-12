import type { ProviderName } from "./types/index.js"
import { Provider, ClaudeProvider, CodexProvider, OpenCodeProvider, GeminiProvider } from "./providers/index.js"

/**
 * Create a provider instance by name
 *
 * @param name - The provider name ("claude", "codex", "opencode", "gemini")
 * @returns A provider instance
 * @throws Error if the provider name is unknown
 */
export function createProvider(name: ProviderName | string): Provider {
  switch (name) {
    case "claude":
      return new ClaudeProvider()
    case "codex":
      return new CodexProvider()
    case "opencode":
      return new OpenCodeProvider()
    case "gemini":
      return new GeminiProvider()
    default:
      throw new Error(`Unknown provider: ${name}. Valid providers are: claude, codex, opencode, gemini`)
  }
}

/**
 * Get all available provider names
 */
export function getProviderNames(): ProviderName[] {
  return ["claude", "codex", "opencode", "gemini"]
}

/**
 * Check if a provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
  return getProviderNames().includes(name as ProviderName)
}
