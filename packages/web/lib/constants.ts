/**
 * Constants for Simple Chat
 * Re-exports shared constants from @background-agents/common
 */

import { PATHS as COMMON_PATHS, SANDBOX_CONFIG as COMMON_SANDBOX_CONFIG, TIMEOUTS } from "@background-agents/common"

// Re-export PATHS directly (same values)
export const PATHS = COMMON_PATHS

// Override SANDBOX_CONFIG with simple-chat specific label
export const SANDBOX_CONFIG = {
  ...COMMON_SANDBOX_CONFIG,
  /** Label key for identifying simple-chat sandboxes */
  LABEL_KEY: "simple-chat",
} as const

// Re-export TIMEOUTS
export { TIMEOUTS }
