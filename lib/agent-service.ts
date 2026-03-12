/**
 * Agent Service - Unified interface for background agent execution
 * Wraps the background-agents SDK with application-specific configuration
 */

import { createBackgroundSession } from "background-agents"
import type { ProviderName, ModelConfig } from "./types"
import { AGENT_CONFIGS } from "./types"
import { AGENT_PROVIDER, CREDENTIAL_TYPE } from "./constants"
import type {
  BackgroundSession,
  AgentServiceOptions,
  DecryptedCredentials,
} from "./agent-types"

/**
 * Creates and configures a background agent session
 * Wraps the background-agents SDK with our specific configuration
 */
export async function createAgentSession(
  options: AgentServiceOptions
): Promise<BackgroundSession> {
  const { provider, sandbox, model, sessionId, env, outputFile, timeout } = options

  // Create the session using the SDK
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await createBackgroundSession(provider, {
    sandbox: sandbox as any,
    env,
    model,
    sessionId,
    outputFile,
    timeout: timeout || 600000, // 10 minutes default
  })

  return session
}

/**
 * Build environment variables required for a specific provider
 */
export function getProviderEnv(
  provider: ProviderName,
  credentials: DecryptedCredentials,
  model?: string
): Record<string, string> {
  const env: Record<string, string> = {}

  switch (provider) {
    case AGENT_PROVIDER.CLAUDE:
      // Claude requires Anthropic API key
      if (credentials.anthropicApiKey) {
        env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
      }
      // Claude Max auth token is handled differently (via credentials file)
      break

    case AGENT_PROVIDER.CODEX:
      // Codex requires OpenAI API key
      if (credentials.openaiApiKey) {
        env.OPENAI_API_KEY = credentials.openaiApiKey
      }
      break

    case AGENT_PROVIDER.OPENCODE:
      // OpenCode can use multiple providers depending on the model
      // Add all available keys, the CLI will use the appropriate one
      if (credentials.anthropicApiKey) {
        env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
      }
      if (credentials.openaiApiKey) {
        env.OPENAI_API_KEY = credentials.openaiApiKey
      }
      // Free models (Groq, OpenRouter) don't require keys
      break
  }

  return env
}

/**
 * Validate that required credentials are available for a provider/model combination
 */
export function validateCredentials(
  provider: ProviderName,
  model: string | undefined,
  credentials: DecryptedCredentials
): { valid: boolean; missing: string[] } {
  const missing: string[] = []
  const config = AGENT_CONFIGS[provider]

  // Find the model config if specified
  let modelConfig: ModelConfig | undefined
  if (model) {
    modelConfig = config.models.find((m: ModelConfig) => m.id === model)
  }

  // If model requires a specific key, check for it
  if (modelConfig) {
    switch (modelConfig.requiresKey) {
      case CREDENTIAL_TYPE.ANTHROPIC:
        if (!credentials.anthropicApiKey && !credentials.anthropicAuthToken) {
          missing.push("Anthropic API key or Claude Max subscription")
        }
        break
      case CREDENTIAL_TYPE.OPENAI:
        if (!credentials.openaiApiKey) {
          missing.push("OpenAI API key")
        }
        break
      case CREDENTIAL_TYPE.NONE:
        // Free model, no credentials required
        break
    }
  } else {
    // No model specified, check provider's default requirements
    for (const req of config.requiredCredentials) {
      if (req === "anthropicApiKey" && !credentials.anthropicApiKey && !credentials.anthropicAuthToken) {
        missing.push("Anthropic API key")
      }
      if (req === "openaiApiKey" && !credentials.openaiApiKey) {
        missing.push("OpenAI API key")
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}

/**
 * Get the default model for a provider
 */
export function getDefaultModelForProvider(provider: ProviderName): string {
  const config = AGENT_CONFIGS[provider]
  return config.models[0]?.id || ""
}

/**
 * Check if a model is a free model (no API key required)
 */
export function isFreeModel(provider: ProviderName, modelId: string): boolean {
  const config = AGENT_CONFIGS[provider]
  const model = config.models.find((m: ModelConfig) => m.id === modelId)
  return model?.requiresKey === CREDENTIAL_TYPE.NONE
}

/**
 * Get available models for a provider based on credentials
 */
export function getAvailableModels(
  provider: ProviderName,
  credentials: {
    hasAnthropicApiKey?: boolean
    hasAnthropicAuthToken?: boolean
    hasOpenaiApiKey?: boolean
  }
): ModelConfig[] {
  const config = AGENT_CONFIGS[provider]

  return config.models.filter((model: ModelConfig) => {
    switch (model.requiresKey) {
      case CREDENTIAL_TYPE.ANTHROPIC:
        return credentials.hasAnthropicApiKey || credentials.hasAnthropicAuthToken
      case CREDENTIAL_TYPE.OPENAI:
        return credentials.hasOpenaiApiKey
      case CREDENTIAL_TYPE.NONE:
        return true // Free models always available
      default:
        return false
    }
  })
}
