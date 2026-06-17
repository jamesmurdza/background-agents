/**
 * GitHub Copilot CLI tool name mappings
 *
 * Maps Copilot's built-in tool names to canonical tool names.
 * Copilot CLI uses straightforward tool names like "shell", "edit",
 * "read_file", "write_file", "create_file", and "ls".
 */

export const COPILOT_TOOL_MAPPINGS: Record<string, string> = {
  // Shell execution
  shell: "shell",
  bash: "shell",
  run_command: "shell",
  // File reading
  read_file: "read",
  read: "read",
  view: "read",
  // File writing
  write_file: "write",
  create_file: "write",
  write: "write",
  // File editing
  edit: "edit",
  apply_patch: "edit",
  patch: "edit",
  // File search / listing
  ls: "glob",
  list: "glob",
  glob: "glob",
  // Content search
  grep: "grep",
  grep_search: "grep",
}
