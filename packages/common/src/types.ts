/**
 * Shared types for upstream-agents packages
 */

// =============================================================================
// Content Blocks (for displaying agent output)
// =============================================================================

export interface ToolCall {
  tool: string
  summary: string
  fullSummary?: string
  filePath?: string
  output?: string
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: ToolCall[] }
