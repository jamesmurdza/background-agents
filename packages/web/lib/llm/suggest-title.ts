import { generateWithOpenRouter } from "@/lib/llm/openrouter"

const DEFAULT_TITLE_PROMPT = `Generate a short 2-5 word title for this request. Reply with just the title, no quotes, markdown, or extra punctuation.

User's message: {prompt}`

/**
 * Generate a short title from a prompt using an LLM, falling back to a
 * truncated version of the prompt if OpenRouter isn't configured or errors.
 */
export async function suggestTitleFromPrompt(
  promptText: string,
  opts: { promptTemplate?: string } = {}
): Promise<string> {
  const template = opts.promptTemplate ?? DEFAULT_TITLE_PROMPT
  const fallbackName = createFallbackName(promptText)
  const raw = await generateWithOpenRouter(
    template.replace("{prompt}", promptText.slice(0, 500)),
    { fallback: fallbackName }
  )
  return sanitizeName(raw) || fallbackName
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
