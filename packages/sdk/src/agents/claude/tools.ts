/**
 * Claude tool name mappings
 *
 * Maps Claude CLI tool names to canonical tool names.
 */

export const CLAUDE_TOOL_MAPPINGS: Record<string, string> = {
  Write: "write",
  Read: "read",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
  Bash: "shell",
  WebSearch: "web_search",
}
