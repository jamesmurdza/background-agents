import { generateWithUserLLM } from "@/lib/llm"

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

  // Truncate diff if too long (keep first ~4000 chars to stay within token limits)
  const truncatedDiff =
    diff.length > 4000 ? diff.slice(0, 4000) + "\n... (diff truncated)" : diff

  const prompt = COMMIT_MESSAGE_PROMPT.replace("{diff}", truncatedDiff)

  const result = await generateWithUserLLM({ userId, prompt })

  if (result.error || !result.text) {
    return {
      message: DEFAULT_COMMIT_MESSAGE,
      isAiGenerated: false,
      reason: result.error || "llm_error",
    }
  }

  const sanitizedMessage = sanitizeCommitMessage(result.text)

  // If the sanitized message is empty, use default
  if (!sanitizedMessage) {
    return {
      message: DEFAULT_COMMIT_MESSAGE,
      isAiGenerated: false,
      reason: "llm_error",
    }
  }

  return {
    message: sanitizedMessage,
    isAiGenerated: true,
    reason: "success",
  }
}
