import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

// Shared OpenRouter text-generation helper. Used for small, best-effort LLM
// tasks (chat-name suggestions, PR title/description generation). When no key is
// configured or the call fails, callers fall back to a deterministic string, so
// these features degrade gracefully (and stay deterministic in tests/offline).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const OPENROUTER_MODEL = "openai/gpt-oss-20b"

/**
 * Generate text via OpenRouter. Returns the trimmed model output, or the
 * provided `fallback` when OpenRouter isn't configured, the call errors, or the
 * model returns nothing.
 */
export async function generateWithOpenRouter(
  prompt: string,
  opts: { fallback: string }
): Promise<string> {
  if (!OPENROUTER_API_KEY) return opts.fallback
  try {
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
    })
    const result = await generateText({
      model: openrouter(OPENROUTER_MODEL),
      prompt,
    })
    return result.text?.trim() || opts.fallback
  } catch (error) {
    console.error("[openrouter] generateText error:", error)
    return opts.fallback
  }
}
