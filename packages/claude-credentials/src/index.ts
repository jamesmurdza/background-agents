/**
 * @background-agents/claude-credentials
 *
 * Claude Code OAuth credential generation via ccauth and Daytona.
 * This package contains the pure credential generation logic without
 * any database dependencies.
 */

// Types
export type { ClaudeOAuthCredentials } from "./types"

// Constants
export { CLAUDE_CREDS_KEY, CLAUDE_COOKIES_KEY } from "./constants"

// Generation logic
export {
  CCAUTH_PINNED_SHA,
  resolveLatestCCAuthSha,
  getCCAuthImage,
  isClaudeOAuthCredentials,
  generateClaudeCredentials,
  RefreshTokenExpiredError,
  type GenerateCredentialsOptions,
} from "./generate"
