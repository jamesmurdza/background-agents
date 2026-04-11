/**
 * Zod validation schemas for API request bodies
 * Centralizes validation logic and provides type-safe request parsing
 */

import { z } from "zod"

// =============================================================================
// Common Schemas
// =============================================================================

/** Non-empty string validation */
export const nonEmptyString = z.string().min(1)

/** Optional string that can be empty */
export const optionalString = z.string().optional()

/** Positive integer validation */
export const positiveInt = z.number().int().positive()

// =============================================================================
// GitHub Schemas
// =============================================================================

export const createRepoSchema = z.object({
  name: nonEmptyString,
  description: optionalString,
  isPrivate: z.boolean().optional(),
})

export const forkRepoSchema = z.object({
  owner: nonEmptyString,
  name: nonEmptyString,
})

export const createPRSchema = z.object({
  owner: nonEmptyString,
  repo: nonEmptyString,
  head: nonEmptyString,
  base: nonEmptyString,
})

export const compareSchema = z.object({
  owner: nonEmptyString,
  repo: nonEmptyString,
  base: optionalString,
  head: optionalString,
  commitHash: optionalString,
}).refine(
  (data) => data.commitHash || (data.base && data.head),
  { message: "Must provide commitHash or base+head" }
)

// =============================================================================
// Sandbox Schemas
// =============================================================================

export const createSandboxSchema = z.object({
  repoId: optionalString,
  repoOwner: nonEmptyString,
  repoName: nonEmptyString,
  baseBranch: optionalString,
  newBranch: nonEmptyString,
  startCommit: optionalString,
})

export const sandboxIdSchema = z.object({
  sandboxId: nonEmptyString,
})

export const agentQuerySchema = z.object({
  sandboxId: nonEmptyString,
  prompt: nonEmptyString,
  previewUrlPattern: optionalString,
  repoName: optionalString,
  messageId: optionalString,
})

export const autostopIntervalSchema = z.object({
  interval: z.number().int().min(5).max(20),
})

export const gitActionSchema = z.object({
  sandboxId: nonEmptyString,
  repoPath: nonEmptyString,
  action: nonEmptyString,
  targetBranch: optionalString,
  currentBranch: optionalString,
  repoOwner: optionalString,
  repoApiName: optionalString,
  branchName: optionalString,
  sinceCommit: optionalString,
  commitHash: optionalString,
  newBranchName: optionalString,
})

// =============================================================================
// Repo/Branch Schemas
// =============================================================================

export const createDbRepoSchema = z.object({
  name: nonEmptyString,
  owner: nonEmptyString,
  avatar: optionalString,
  defaultBranch: nonEmptyString,
})

export const branchDraftSchema = z.object({
  branchId: nonEmptyString,
  draftPrompt: z.string().optional(),
})

export const branchUpdateSchema = z.object({
  branchId: nonEmptyString,
  status: optionalString,
  prUrl: optionalString,
  name: optionalString,
  draftPrompt: optionalString,
  lastShownCommitHash: optionalString,
})

export const messageCreateSchema = z.object({
  branchId: nonEmptyString,
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    tool: z.string(),
    summary: z.string(),
    timestamp: z.string(),
  })).optional(),
  contentBlocks: z.array(z.unknown()).optional(),
  timestamp: z.string(),
  commitHash: optionalString,
  commitMessage: optionalString,
  assistantSource: z.enum(["model", "system", "commit"]).optional(),
})

export const messageUpdateSchema = z.object({
  messageId: nonEmptyString,
  content: optionalString,
  toolCalls: z.array(z.unknown()).optional(),
  contentBlocks: z.array(z.unknown()).optional(),
})

// =============================================================================
// User Schemas
// =============================================================================

export const credentialsSchema = z.object({
  anthropicApiKey: optionalString,
  anthropicAuthToken: optionalString,
  anthropicAuthType: z.enum(["api-key", "claude-max"]).optional(),
  openaiApiKey: optionalString,
  sandboxAutoStopInterval: z.number().int().min(5).max(20).optional(),
})

// =============================================================================
// Validation Helper
// =============================================================================

export interface ValidationResult<T> {
  success: true
  data: T
}

export interface ValidationError {
  success: false
  error: string
}

export type ValidationResponse<T> = ValidationResult<T> | ValidationError

/**
 * Validates request body against a Zod schema
 * Returns typed data on success, error message on failure
 */
export function validateBody<T>(
  body: unknown,
  schema: z.ZodSchema<T>
): ValidationResponse<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    const firstError = result.error.errors[0]
    const path = firstError.path.length > 0 ? `${firstError.path.join(".")}: ` : ""
    return {
      success: false,
      error: `${path}${firstError.message}`,
    }
  }
  return { success: true, data: result.data }
}

/**
 * Type guard to check if validation succeeded
 */
export function isValidationError<T>(
  result: ValidationResponse<T>
): result is ValidationError {
  return !result.success
}

// =============================================================================
// Type Exports (for use in API routes)
// =============================================================================

export type CreateRepoInput = z.infer<typeof createRepoSchema>
export type ForkRepoInput = z.infer<typeof forkRepoSchema>
export type CreatePRInput = z.infer<typeof createPRSchema>
export type CompareInput = z.infer<typeof compareSchema>
export type CreateSandboxInput = z.infer<typeof createSandboxSchema>
export type AgentQueryInput = z.infer<typeof agentQuerySchema>
export type AutostopIntervalInput = z.infer<typeof autostopIntervalSchema>
export type GitActionInput = z.infer<typeof gitActionSchema>
export type CreateDbRepoInput = z.infer<typeof createDbRepoSchema>
export type BranchDraftInput = z.infer<typeof branchDraftSchema>
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>
export type MessageCreateInput = z.infer<typeof messageCreateSchema>
export type MessageUpdateInput = z.infer<typeof messageUpdateSchema>
export type CredentialsInput = z.infer<typeof credentialsSchema>
