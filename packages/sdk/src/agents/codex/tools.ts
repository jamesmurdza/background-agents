/**
 * Codex tool name mappings
 *
 * Maps Codex item types and MCP tools to canonical tool names.
 */

export const CODEX_TOOL_MAPPINGS: Record<string, string> = {
  command_execution: "shell",
  file_change: "write",
  // MCP tool names
  read: "read",
  read_file: "read",
  write: "write",
  write_file: "write",
  edit: "edit",
  apply_patch: "edit",
  patch: "edit",
  glob: "glob",
  glob_file_search: "glob",
  grep: "grep",
  grep_search: "grep",
  bash: "shell",
  shell: "shell",
  run_command: "shell",
}

/**
 * Normalize Codex tool name to canonical form.
 */
export function normalizeCodexToolName(
  itemType: string,
  toolName?: string
): string {
  // Check item type first
  const fromType = CODEX_TOOL_MAPPINGS[itemType]
  if (fromType) return fromType

  // For MCP tool calls, check the tool name
  if (itemType === "mcp_tool_call" && toolName) {
    const lower = toolName.toLowerCase()
    return CODEX_TOOL_MAPPINGS[lower] ?? lower
  }

  return itemType
}
