/**
 * Pi Coding Agent tool name mappings
 *
 * Maps Pi CLI tool names to canonical tool names.
 * Pi uses: read, bash, edit, write, grep, find, ls by default.
 */

export const PI_TOOL_MAPPINGS: Record<string, string> = {
  read: "read",
  write: "write",
  edit: "edit",
  bash: "shell",
  grep: "grep",
  find: "glob",
  ls: "glob",
}
