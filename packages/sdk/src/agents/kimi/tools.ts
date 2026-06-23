/**
 * Kimi tool name mappings
 *
 * Kimi Code is a Claude-Code-shaped CLI (same stream-json output), so its tool
 * names match Claude's. Maps Kimi CLI tool names to canonical tool names.
 */

export const KIMI_TOOL_MAPPINGS: Record<string, string> = {
  Write: "write",
  Read: "read",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
  Bash: "shell",
  WebSearch: "web_search",
}
