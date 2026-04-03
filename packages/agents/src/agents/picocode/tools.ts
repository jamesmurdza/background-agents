/**
 * Picocode tool name mappings
 *
 * Maps Picocode tool names to canonical tool names.
 * Picocode tool names (from tools.rs): read_file, write_file, edit_file,
 * copy_file, move_file, list_dir, make_dir, remove, glob_files, grep_text, bash, agent_browser
 */

export const PICOCODE_TOOL_MAPPINGS: Record<string, string> = {
  // File operations
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  copy_file: "write", // maps to write since it creates/copies files
  move_file: "write", // maps to write since it modifies filesystem

  // Directory operations
  list_dir: "glob",
  make_dir: "shell", // directory creation is a shell-like operation
  remove: "shell", // file/dir removal is a shell-like operation

  // Search operations
  glob_files: "glob",
  grep_text: "grep",

  // Shell/command execution
  bash: "shell",

  // Browser automation (no direct canonical mapping, keep as-is)
  agent_browser: "agent_browser",
}
