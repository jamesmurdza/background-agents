import type { ProviderName, ProviderOptions } from "./types/index.js"
import { Provider, ClaudeProvider, CodexProvider, OpenCodeProvider, GeminiProvider } from "./providers/index.js"

/**
 * Create a provider instance by name
 *
 * @param name - The provider name ("claude", "codex", "opencode", "gemini")
 * @param options - Provider options (sandbox or dangerouslyAllowLocalExecution)
 * @returns A provider instance
 * @throws Error if the provider name is unknown
 *
 * @example
 * ```typescript
 * // With sandbox (recommended)
 * const sandbox = createSandbox({ apiKey: process.env.DAYTONA_API_KEY })
 * await sandbox.create()
 * const provider = createProvider("claude", { sandbox })
 *
 * // With dangerous local execution
 * const provider = createProvider("claude", { dangerouslyAllowLocalExecution: true })
 * ```
 */
export function createProvider(name: ProviderName | string, options: ProviderOptions): Provider {
  switch (name) {
    case "claude":
      return new ClaudeProvider(options)
    case "codex":
      return new CodexProvider(options)
    case "opencode":
      return new OpenCodeProvider(options)
    case "gemini":
      return new GeminiProvider(options)
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
