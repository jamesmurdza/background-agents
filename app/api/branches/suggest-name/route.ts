import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getBranchWithAuth,
  badRequest,
  notFound,
  internalError,
} from "@/lib/api-helpers"
import { generateWithUserLLM } from "@/lib/llm"

const SUGGESTION_PROMPT = `Based on the conversation below, suggest a concise Git branch name that describes the work being done.

Requirements:
- Use 2-4 words maximum (not counting the prefix)
- All lowercase
- Words separated by hyphens
- Choose the CORRECT prefix based on the type of work:
  - fix/ = fixing a bug or issue
  - feat/ = adding a new feature or capability
  - refactor/ = restructuring code without changing behavior
  - docs/ = documentation changes
  - test/ = adding or updating tests
  - chore/ = maintenance tasks, dependencies, config
- Be specific but concise
- Do NOT use "fix" in the description if using feat/ prefix (and vice versa)

Conversation:
{conversation}

Reply with ONLY the branch name, nothing else. Examples: fix/auth-validation, feat/dark-mode, refactor/api-client`

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

  const result = await generateWithUserLLM({ userId, prompt })

  if (result.error === "no_api_key") {
    return badRequest("No API key configured. Please add an Anthropic or OpenAI API key in settings.")
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
