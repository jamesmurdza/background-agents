/**
 * Gemini tool name mappings
 *
 * Maps Gemini CLI tool names to canonical tool names.
 */

export const GEMINI_TOOL_MAPPINGS: Record<string, string> = {
  // Shell / command execution
  execute_code: "shell",
  run_command: "shell",
  run_shell_command: "shell",
  bash: "shell",
  // File operations
  write_file: "write",
  write_todos: "write",
  read_file: "read",
  apply_patch: "edit",
  replace: "edit",
  // Search
  glob_file_search: "glob",
  list_directory: "glob",
  grep_search: "grep",
}
