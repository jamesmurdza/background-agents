import { prisma } from "@/lib/prisma"
import { decryptUserCredentials } from "@/lib/api-helpers"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

const COMMIT_MESSAGE_PROMPT = `Based on the git diff below, write a concise and descriptive commit message.

Requirements:
- Use the conventional commit format: <type>: <description>
- Types: feat (new feature), fix (bug fix), refactor (code restructuring), docs (documentation), test (tests), chore (maintenance), style (formatting)
- Keep the description under 72 characters
- Focus on WHAT changed and WHY, not HOW
- Use imperative mood (e.g., "add" not "added")
- Be specific but concise
- Do not include any quotes around the message

Git diff:
{diff}

Reply with ONLY the commit message, nothing else. Examples:
feat: add dark mode toggle to settings page
fix: resolve authentication timeout on slow connections
refactor: extract validation logic into separate module`

const DEFAULT_COMMIT_MESSAGE = "Auto-commit: agent changes"

/**
 * Sanitize a commit message to ensure it's valid
 */
function sanitizeCommitMessage(message: string): string {
  return message
    // Remove any quotes the LLM might add
    .replace(/^["'`]|["'`]$/g, "")
    // Remove backticks
    .replace(/`/g, "")
    // Ensure single line (take first line only)
    .split("\n")[0]
    // Trim whitespace
    .trim()
    // Limit length to 72 chars (git best practice)
    .slice(0, 72)
}

export interface GenerateCommitMessageOptions {
  userId: string
  diff: string
}

export interface GenerateCommitMessageResult {
  message: string
  isAiGenerated: boolean
  reason?: "no_api_key" | "no_diff" | "llm_error" | "success"
}

/**
 * Generates a commit message using AI if available, otherwise returns the default message.
 * This function is designed to never throw - it always returns a valid commit message.
 */
export async function generateCommitMessage(
  options: GenerateCommitMessageOptions
): Promise<GenerateCommitMessageResult> {
  const { userId, diff } = options

  // If no diff provided, use default message
  if (!diff || diff.trim().length === 0) {
    return {
      message: DEFAULT_COMMIT_MESSAGE,
      isAiGenerated: false,
      reason: "no_diff",
    }
  }

  try {
    // Get user's API keys
    const userCredentials = await prisma.userCredentials.findUnique({
      where: { userId },
    })
    const { anthropicApiKey, openaiApiKey } = decryptUserCredentials(userCredentials)

    // If no API keys, return default message
    if (!anthropicApiKey && !openaiApiKey) {
      return {
        message: DEFAULT_COMMIT_MESSAGE,
        isAiGenerated: false,
        reason: "no_api_key",
      }
    }

    // Truncate diff if too long (keep first ~4000 chars to stay within token limits)
    const truncatedDiff =
      diff.length > 4000 ? diff.slice(0, 4000) + "\n... (diff truncated)" : diff

    const prompt = COMMIT_MESSAGE_PROMPT.replace("{diff}", truncatedDiff)

    let suggestedMessage: string

    if (anthropicApiKey) {
      // Prefer Anthropic (Claude) - use haiku for speed
      const anthropic = createAnthropic({ apiKey: anthropicApiKey })
      const result = await generateText({
        model: anthropic("claude-3-haiku-20240307"),
        prompt,
      })
      suggestedMessage = sanitizeCommitMessage(result.text.trim())
    } else {
      // Fallback to OpenAI - use gpt-4o-mini for speed
      const openai = createOpenAI({ apiKey: openaiApiKey! })
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
      })
      suggestedMessage = sanitizeCommitMessage(result.text.trim())
    }

    // If the sanitized message is empty, use default
    if (!suggestedMessage) {
      return {
        message: DEFAULT_COMMIT_MESSAGE,
        isAiGenerated: false,
        reason: "llm_error",
      }
    }

    return {
      message: suggestedMessage,
      isAiGenerated: true,
      reason: "success",
    }
  } catch (error) {
    console.error("[generateCommitMessage] Error generating suggestion:", error)
    // Return default message on any error
    return {
      message: DEFAULT_COMMIT_MESSAGE,
      isAiGenerated: false,
      reason: "llm_error",
    }
  }
}
