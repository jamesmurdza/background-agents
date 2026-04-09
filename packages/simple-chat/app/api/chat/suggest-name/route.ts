import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

// OpenRouter API configuration (same as web app)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const OPENROUTER_MODEL = "openai/gpt-oss-20b"

const NAME_PROMPT = `Generate a short 2-5 word title for this chat request. Reply with just the title, no quotes, markdown, or extra punctuation.

User's message: {prompt}`

/**
 * POST /api/chat/suggest-name
 * Generates a chat name using OpenRouter LLM
 */
export async function POST(req: Request) {
  const body = await req.json()
  const { prompt } = body

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "Missing prompt" }, { status: 400 })
  }

  if (!OPENROUTER_API_KEY) {
    // Fallback: truncate prompt to create a simple name
    const fallbackName = createFallbackName(prompt)
    return Response.json({ name: fallbackName })
  }

  try {
    const openrouter = createOpenAI({
      apiKey: OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
    })

    const result = await generateText({
      model: openrouter(OPENROUTER_MODEL),
      prompt: NAME_PROMPT.replace("{prompt}", prompt.slice(0, 500)),
    })

    const name = sanitizeName(result.text || createFallbackName(prompt))
    return Response.json({ name })
  } catch (error) {
    console.error("[suggest-name] LLM error:", error)
    // Fallback on error
    const fallbackName = createFallbackName(prompt)
    return Response.json({ name: fallbackName })
  }
}

/**
 * Create a fallback name by truncating the prompt
 */
function createFallbackName(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 5)
  let name = words.join(" ")
  if (name.length > 40) {
    name = name.slice(0, 37) + "..."
  }
  return name
}

/**
 * Sanitize the LLM-generated name
 */
function sanitizeName(name: string): string {
  return name
    .trim()
    // Remove quotes the LLM might add
    .replace(/^["']|["']$/g, "")
    // Remove markdown
    .replace(/[*_`#]/g, "")
    // Limit length
    .slice(0, 50)
}
