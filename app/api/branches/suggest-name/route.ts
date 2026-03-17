import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getBranchWithAuth,
  badRequest,
  notFound,
  internalError,
  decryptUserCredentials,
} from "@/lib/api-helpers"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

const SUGGESTION_PROMPT = `Based on the conversation below, suggest a concise Git branch name that describes the work being done.

Requirements:
- Use 2-4 words maximum (not counting the prefix)
- All lowercase
- Words separated by hyphens
- Use a conventional prefix with a SLASH separator: feat/, fix/, refactor/, docs/, test/, chore/
- Be specific but concise

Conversation:
{conversation}

Reply with ONLY the branch name, nothing else. Example: fix/auth-validation`

/**
 * POST /api/branches/suggest-name
 * Suggests a branch name based on conversation history using AI
 */
export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { branchId } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership
  const branch = await getBranchWithAuth(branchId, userId)
  if (!branch) {
    return notFound("Branch not found")
  }

  // Get user's API keys
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })
  const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)

  // Need at least one API key
  if (!anthropicApiKey && !openaiApiKey) {
    return badRequest("No API key configured. Please add an Anthropic or OpenAI API key in settings.")
  }

  // Get messages for this branch (limit to first few for context)
  const messages = await prisma.message.findMany({
    where: { branchId },
    orderBy: { createdAt: "asc" },
    take: 10, // First 10 messages should be enough context
    select: {
      role: true,
      content: true,
    },
  })

  if (messages.length === 0) {
    return badRequest("No conversation history to generate suggestion from")
  }

  // Build conversation summary (truncate long messages)
  const conversationSummary = messages
    .map((m) => {
      const content = m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content
      return `${m.role}: ${content}`
    })
    .join("\n\n")

  const prompt = SUGGESTION_PROMPT.replace("{conversation}", conversationSummary)

  try {
    let suggestedName: string

    if (anthropicApiKey) {
      // Prefer Anthropic (Claude) - use haiku for speed
      const anthropic = createAnthropic({ apiKey: anthropicApiKey })
      const result = await generateText({
        model: anthropic("claude-3-haiku-20240307"),
        prompt,
      })
      suggestedName = result.text.trim()
    } else {
      // Fallback to OpenAI - use gpt-4o-mini for speed
      const openai = createOpenAI({ apiKey: openaiApiKey })
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
      })
      suggestedName = result.text.trim()
    }

    // Sanitize the suggestion to ensure it's a valid branch name
    suggestedName = sanitizeBranchName(suggestedName)

    return Response.json({ suggestedName })
  } catch (error) {
    console.error("[suggest-name] Error generating suggestion:", error)
    return internalError(error)
  }
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
    // Remove invalid git branch characters
    .replace(/[~^:?*\[\]\\@{}<>|!#$%&()+=,;]/g, "")
    // Remove consecutive hyphens
    .replace(/-+/g, "-")
    // Remove leading/trailing hyphens or dots
    .replace(/^[-.]|[-.]$/g, "")
    // Limit length
    .slice(0, 50)
}
