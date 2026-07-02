import { generateWithOpenRouter } from "@/lib/llm/openrouter"

const NAME_PROMPT = `Generate a short 2-5 word title for this chat request. Reply with just the title, no quotes, markdown, or extra punctuation.

User's message: {prompt}`

/**
 * POST /api/chat/suggest-name
 * Generates a chat name using an LLM (falls back to a truncated prompt).
 */
export async function POST(req: Request) {
  const body = await req.json()
  const { prompt } = body

  if (!prompt || typeof prompt !== "string") {
    return Response.json({ error: "Missing prompt" }, { status: 400 })
  }

  const fallbackName = createFallbackName(prompt)
  const raw = await generateWithOpenRouter(
    NAME_PROMPT.replace("{prompt}", prompt.slice(0, 500)),
    { fallback: fallbackName }
  )
  const name = sanitizeName(raw) || fallbackName
  return Response.json({ name })
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
