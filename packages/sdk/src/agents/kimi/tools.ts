/**
 * Kimi tool name mappings
 *
 * Kimi Code is a Claude-Code-shaped CLI (same stream-json output), so its tool
 * names match Claude's. Reuse Claude's canonical mapping rather than keeping a
 * second copy in sync.
 */

import { CLAUDE_TOOL_MAPPINGS } from "../claude/tools"

export const KIMI_TOOL_MAPPINGS: Record<string, string> = CLAUDE_TOOL_MAPPINGS
