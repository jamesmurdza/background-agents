/**
 * Goose tool name mappings
 *
 * Maps Goose CLI tool names to canonical tool names.
 *
 * Goose uses namespaced tool names in the format "extension__tool",
 * e.g., "developer__shell", "developer__text_editor".
 */

export const GOOSE_TOOL_MAPPINGS: Record<string, string> = {
  // Developer extension tools
  developer__shell: "shell",
  developer__text_editor: "edit",
  developer__read_file: "read",
  developer__write_file: "write",
  developer__list_directory: "glob",

  // Common MCP tool names that may appear
  shell: "shell",
  bash: "shell",
  text_editor: "edit",
  read_file: "read",
  write_file: "write",
  list_directory: "glob",
  search: "grep",
  grep: "grep",

  // Computer controller extension
  computercontroller__shell: "shell",
  computercontroller__read_file: "read",
  computercontroller__write_file: "write",
}
