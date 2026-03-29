import { prisma } from "@/lib/prisma"
import { decryptUserCredentials } from "@/lib/api-helpers"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

// OpenRouter API configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const OPENROUTER_MODEL = "openai/gpt-oss-20b"

export interface LLMGenerateOptions {
  userId: string
  prompt: string
}

export interface LLMGenerateResult {
  text: string | null
  error: "no_api_key" | "llm_error" | null
}

/**
 * Generates text using OpenRouter (openai/gpt-oss-20b).
 * This is used as a fallback when users don't have their own API keys configured.
 *
 * @returns The generated text, or null if generation failed.
 */
async function generateWithOpenRouter(prompt: string): Promise<string | null> {
  const t0 = Date.now()
  const elapsed = () => `${Date.now() - t0}ms`

  if (!OPENROUTER_API_KEY) {
    console.log("[generateWithOpenRouter] No OpenRouter API key configured")
    return null
  }

  try {
    console.log(
      "[generateWithOpenRouter] start",
      JSON.stringify({
        model: OPENROUTER_MODEL,
        baseURL: OPENROUTER_BASE_URL,
        promptChars: prompt.length,
      }),
    )

    // Use createOpenAI with OpenRouter's base URL (OpenRouter is OpenAI-compatible)
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
    })

    console.log(`[generateWithOpenRouter] client created, calling generateText… (+${elapsed()})`)

    const genT0 = Date.now()
    const result = await generateText({
      model: openrouter(OPENROUTER_MODEL),
      prompt,
    })

    const genMs = Date.now() - genT0
    const raw = result.text ?? ""
    console.log(
      "[generateWithOpenRouter] generateText returned",
      JSON.stringify({
        generateTextMs: genMs,
        totalMs: Date.now() - t0,
        rawChars: raw.length,
        trimmedChars: raw.trim().length,
        preview: raw.slice(0, 120).replace(/\s+/g, " "),
      }),
    )

    return raw.trim()
  } catch (error) {
    console.error(`[generateWithOpenRouter] error after ${elapsed()}:`, error)
    if (error instanceof Error && error.cause) {
      console.error("[generateWithOpenRouter] error.cause:", error.cause)
    }
    return null
  }
}

/**
 * Generates text using the user's configured LLM (Anthropic preferred, OpenAI fallback).
 * If no user API keys are available, falls back to OpenRouter's free model.
 * Uses fast models (Claude Haiku / GPT-4o-mini) for low latency.
 *
 * @returns The generated text, or null with an error reason if generation failed.
 */
export async function generateWithUserLLM(
  options: LLMGenerateOptions
): Promise<LLMGenerateResult> {
  const { userId, prompt } = options
  const t0 = Date.now()
  const elapsed = () => `${Date.now() - t0}ms`

  try {
    const dbT0 = Date.now()
    const userCredentials = await prisma.userCredentials.findUnique({
      where: { userId },
    })
    console.log(
      "[generateWithUserLLM] credentials loaded",
      JSON.stringify({ userId, dbMs: Date.now() - dbT0, hasRow: !!userCredentials }),
    )

    const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)

    // If no user API keys available, try OpenRouter as fallback
    if (!anthropicApiKey && !openaiApiKey) {
      console.log(`[generateWithUserLLM] no user API keys, OpenRouter fallback (+${elapsed()})`)

      const orT0 = Date.now()
      const openRouterResult = await generateWithOpenRouter(prompt)
      const orMs = Date.now() - orT0
      console.log(
        "[generateWithUserLLM] OpenRouter path finished",
        JSON.stringify({ orMs, totalMs: Date.now() - t0, ok: !!openRouterResult }),
      )

      if (openRouterResult) {
        return { text: openRouterResult, error: null }
      }

      console.log(`[generateWithUserLLM] OpenRouter returned null / no_api_key (+${elapsed()})`)
      return { text: null, error: "no_api_key" }
    }

    const provider = anthropicApiKey ? "Anthropic" : "OpenAI"
    console.log(`[generateWithUserLLM] using ${provider} (+${elapsed()})`)

    let text: string

    if (anthropicApiKey) {
      const anthropic = createAnthropic({ apiKey: anthropicApiKey })
      const genT0 = Date.now()
      const result = await generateText({
        model: anthropic("claude-3-haiku-20240307"),
        prompt,
      })
      console.log(
        "[generateWithUserLLM] Anthropic generateText done",
        JSON.stringify({ ms: Date.now() - genT0, chars: (result.text ?? "").length }),
      )
      text = result.text.trim()
    } else {
      const openai = createOpenAI({ apiKey: openaiApiKey! })
      const genT0 = Date.now()
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
      })
      console.log(
        "[generateWithUserLLM] OpenAI generateText done",
        JSON.stringify({ ms: Date.now() - genT0, chars: (result.text ?? "").length }),
      )
      text = result.text.trim()
    }

    console.log(`[generateWithUserLLM] success totalMs=${Date.now() - t0}`)
    return { text, error: null }
  } catch (error) {
    console.error(`[generateWithUserLLM] error after ${elapsed()}:`, error)
    return { text: null, error: "llm_error" }
  }
}

/**
 * Check if LLM generation is available for a user.
 * Returns true if the user has their own API keys OR if OpenRouter is configured as fallback.
 */
export async function hasUserLLMKey(userId: string): Promise<boolean> {
  // Check if OpenRouter is configured as server-wide fallback
  if (OPENROUTER_API_KEY) {
    return true
  }

  // Check user's personal API keys
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })
  const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)
  return !!(anthropicApiKey || openaiApiKey)
}

/**
 * Check if OpenRouter is configured for server-wide fallback.
 */
export function hasOpenRouterKey(): boolean {
  return !!OPENROUTER_API_KEY
}
