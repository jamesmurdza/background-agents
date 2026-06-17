/**
 * ELIZA tool name mappings
 *
 * Maps ELIZA tool names (Claude-compatible) to canonical tool names.
 */

export const ELIZA_TOOL_MAPPINGS: Record<string, string> = {
  Write: "write",
  Read: "read",
  Bash: "shell",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
}
