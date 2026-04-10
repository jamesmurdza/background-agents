/**
 * Sandbox utilities shared across packages
 */

import { randomUUID } from "crypto"

// =============================================================================
// Sandbox Name Generation
// =============================================================================

/**
 * Generate a unique sandbox name for a user
 *
 * @param userId - The user's ID (first 8 chars will be used)
 * @returns A sandbox name in format: "upstream-{userId prefix}-{uuid}"
 *
 * @example
 * generateSandboxName("user_abc123def456") // "upstream-user_abc-a1b2c3d4"
 */
export function generateSandboxName(userId: string): string {
  const uuid = randomUUID().split("-")[0] // First segment for brevity (8 chars)
  const userIdPrefix = userId.slice(0, 8)
  return `upstream-${userIdPrefix}-${uuid}`
}
