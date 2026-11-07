import { suggestTitleFromPrompt } from "@/lib/llm/suggest-title"

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

  const name = await suggestTitleFromPrompt(prompt)
  return Response.json({ name })
}
