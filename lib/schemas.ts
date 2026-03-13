/**
 * Zod validation schemas for API request bodies
 */

import { z } from "zod"

// =============================================================================
// GitHub Schemas
// =============================================================================

export const createRepoSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isPrivate: z.boolean().optional(),
})

export const forkRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
})

export const createPRSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  head: z.string().min(1),
  base: z.string().min(1),
})

// =============================================================================
// Validation Helper
// =============================================================================

export type ValidationResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Validates request body against a Zod schema
 */
export function validateBody<T>(
  body: unknown,
  schema: z.ZodSchema<T>
): ValidationResponse<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    return { success: false, error: result.error.errors[0].message }
  }
  return { success: true, data: result.data }
}

/**
 * Type guard for validation errors
 */
export function isValidationError<T>(
  result: ValidationResponse<T>
): result is { success: false; error: string } {
  return !result.success
}
