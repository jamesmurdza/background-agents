/**
 * Kilo tool name mappings
 *
 * Kilo is a fork of OpenCode, so its tool names are identical. Reuse
 * OpenCode's canonical mapping rather than keeping a second copy in sync.
 */

import { OPENCODE_TOOL_MAPPINGS } from "../opencode/tools"

export const KILO_TOOL_MAPPINGS: Record<string, string> = OPENCODE_TOOL_MAPPINGS
