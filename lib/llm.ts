import { prisma } from "@/lib/prisma"
import { decryptUserCredentials } from "@/lib/api-helpers"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

export interface LLMGenerateOptions {
  userId: string
  prompt: string
}

export interface LLMGenerateResult {
  text: string | null
  error: "no_api_key" | "llm_error" | null
}

/**
 * Generates text using the user's configured LLM (Anthropic preferred, OpenAI fallback).
 * Uses fast models (Claude Haiku / GPT-4o-mini) for low latency.
 *
 * @returns The generated text, or null with an error reason if generation failed.
 */
export async function generateWithUserLLM(
  options: LLMGenerateOptions
): Promise<LLMGenerateResult> {
  const { userId, prompt } = options

  try {
    // Get user's API keys
    const userCredentials = await prisma.userCredentials.findUnique({
      where: { userId },
    })
    const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)

    // If no API keys available, return error
    if (!anthropicApiKey && !openaiApiKey) {
      return { text: null, error: "no_api_key" }
    }

    let text: string

    if (anthropicApiKey) {
      // Prefer Anthropic (Claude) - use haiku for speed
      const anthropic = createAnthropic({ apiKey: anthropicApiKey })
      const result = await generateText({
        model: anthropic("claude-3-haiku-20240307"),
        prompt,
      })
      text = result.text.trim()
    } else {
      // Fallback to OpenAI - use gpt-4o-mini for speed
      const openai = createOpenAI({ apiKey: openaiApiKey! })
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
      })
      text = result.text.trim()
    }

    return { text, error: null }
  } catch (error) {
    console.error("[generateWithUserLLM] Error:", error)
    return { text: null, error: "llm_error" }
  }
}

/**
 * Check if a user has any LLM API key configured.
 */
export async function hasUserLLMKey(userId: string): Promise<boolean> {
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })
  const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)
  return !!(anthropicApiKey || openaiApiKey)
}
