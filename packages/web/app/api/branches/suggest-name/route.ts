import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getBranchWithAuth,
  badRequest,
  notFound,
  internalError,
} from "@/lib/shared/api-helpers"
import { generateWithUserLLM } from "@/lib/llm/llm"

const SUGGESTION_PROMPT = `Reply with exactly one git branch name, one line, no markdown or quotes — format prefix/slug like feat/dark-mode or fix/auth-timeout (lowercase, hyphens). Prefix must be fix, feat, refactor, docs, test, or chore; slug is 2–4 words.
{conversation}`

/**
 * POST /api/branches/suggest-name
 * Suggests a branch name based on conversation history using AI
 */
export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { branchId, prompt: userPrompt } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return notFound("Branch not found")
  }

  // If a prompt is provided directly (for immediate suggestion on first message),
  // use it instead of fetching from database
  let conversationSummary: string

  if (userPrompt && typeof userPrompt === "string" && userPrompt.trim()) {
    // Use the provided prompt directly - this enables immediate suggestion
    // before the message is saved to the database
    const content = userPrompt.length > 220 ? userPrompt.slice(0, 220) + "..." : userPrompt
    conversationSummary = `user: ${content}`
  } else {
    // Fall back to fetching messages from database
    const messages = await prisma.message.findMany({
      where: { branchId },
      orderBy: { createdAt: "asc" },
      take: 4,
      select: {
        role: true,
        content: true,
      },
    })

    if (messages.length === 0) {
      return badRequest("No conversation history to generate suggestion from")
    }

    conversationSummary = messages
      .map((m) => {
        const content = m.content.length > 220 ? m.content.slice(0, 220) + "..." : m.content
        return `${m.role}: ${content}`
      })
      .join("\n\n")
  }

  const prompt = SUGGESTION_PROMPT.replace("{conversation}", conversationSummary)

  const result = await generateWithUserLLM({ userId, prompt })

  if (result.error === "no_api_key") {
    return badRequest("No API key available. Please add an Anthropic or OpenAI API key in settings, or ensure the server has OpenRouter configured.")
  }

  if (result.error || !result.text) {
    return internalError(new Error("Failed to generate branch name suggestion"))
  }

  // Sanitize the suggestion to ensure it's a valid branch name
  const suggestedName = sanitizeBranchName(result.text)

  return Response.json({ suggestedName })
}

/**
 * Sanitize a string to be a valid git branch name
 */
function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove any quotes or backticks the LLM might add
    .replace(/[`'"]/g, "")
    // Replace spaces and underscores with hyphens
    .replace(/[\s_]+/g, "-")
    // Remove invalid git branch characters (slashes are allowed for prefixes like feat/)
    .replace(/[~^:?*\[\]\\@{}<>|!#$%&()+=,;]/g, "")
    // Remove consecutive hyphens
    .replace(/-+/g, "-")
    // Remove consecutive slashes
    .replace(/\/+/g, "/")
    // Remove leading/trailing hyphens, dots, or slashes
    .replace(/^[-.\/]|[-.\/]$/g, "")
    // Limit length
    .slice(0, 50)
}
