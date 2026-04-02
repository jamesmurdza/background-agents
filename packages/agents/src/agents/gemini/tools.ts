/**
 * Gemini tool name mappings
 *
 * Maps Gemini CLI tool names to canonical tool names.
 */

export const GEMINI_TOOL_MAPPINGS: Record<string, string> = {
  execute_code: "shell",
  run_command: "shell",
  bash: "shell",
  write_file: "write",
  read_file: "read",
  apply_patch: "edit",
  glob_file_search: "glob",
  grep_search: "grep",
}
