/**
 * Application-wide constants and enums
 * Centralizes magic strings and values used across the codebase
 */

// =============================================================================
// Branch/Sandbox Status
// =============================================================================

export const BRANCH_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  CREATING: "creating",
  ERROR: "error",
  STOPPED: "stopped",
} as const

export type BranchStatus = (typeof BRANCH_STATUS)[keyof typeof BRANCH_STATUS]

// Type guard to check if a string is a valid BranchStatus
export function isBranchStatus(value: string): value is BranchStatus {
  return Object.values(BRANCH_STATUS).includes(value as BranchStatus)
}

// =============================================================================
// Delete Modal Merge Status
// =============================================================================

export const MERGE_STATUS = {
  LOADING: "loading",
  MERGED: "merged",
  UNMERGED: "unmerged",
  ERROR: "error",
} as const

export type MergeStatus = (typeof MERGE_STATUS)[keyof typeof MERGE_STATUS]

// =============================================================================
// Agent Execution Status
// =============================================================================

export const EXECUTION_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  ERROR: "error",
} as const

export type ExecutionStatus = (typeof EXECUTION_STATUS)[keyof typeof EXECUTION_STATUS]

// =============================================================================
// Message Roles
// =============================================================================

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE]

// =============================================================================
// Content Block Types
// =============================================================================

export const CONTENT_BLOCK_TYPE = {
  TEXT: "text",
  TOOL_CALLS: "tool_calls",
} as const

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPE)[keyof typeof CONTENT_BLOCK_TYPE]

// =============================================================================
// Random Branch Name Generation
// =============================================================================

/**
 * Word list for generating random branch names
 * Used to create memorable, human-readable branch names like "swift-lunar-amber"
 */
export const BRANCH_NAME_WORDS = [
  "swift",
  "lunar",
  "amber",
  "coral",
  "ember",
  "frost",
  "bloom",
  "spark",
  "drift",
  "pulse",
  "cedar",
  "maple",
  "river",
  "stone",
  "cloud",
  "flame",
  "steel",
  "light",
  "storm",
  "wave",
  "tiger",
  "eagle",
  "brave",
  "vivid",
  "noble",
  "rapid",
  "quiet",
  "sharp",
  "fresh",
  "grand",
] as const

export type BranchNameWord = (typeof BRANCH_NAME_WORDS)[number]

// =============================================================================
// Anthropic Auth Types
// =============================================================================

export const ANTHROPIC_AUTH_TYPE = {
  API_KEY: "api-key",
  CLAUDE_MAX: "claude-max",
} as const

export type AnthropicAuthType = (typeof ANTHROPIC_AUTH_TYPE)[keyof typeof ANTHROPIC_AUTH_TYPE]

// =============================================================================
// Agent Providers
// =============================================================================

export const AGENT_PROVIDER = {
  CLAUDE: "claude",
  CODEX: "codex",
  OPENCODE: "opencode",
} as const

export type AgentProvider = (typeof AGENT_PROVIDER)[keyof typeof AGENT_PROVIDER]

// Type guard to check if a string is a valid AgentProvider
export function isAgentProvider(value: string): value is AgentProvider {
  return Object.values(AGENT_PROVIDER).includes(value as AgentProvider)
}

// =============================================================================
// Model Credential Requirements
// =============================================================================

export const CREDENTIAL_TYPE = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  NONE: "none",
} as const

export type CredentialType = (typeof CREDENTIAL_TYPE)[keyof typeof CREDENTIAL_TYPE]
