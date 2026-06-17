/**
 * Centralized Tool Normalization
 *
 * Single source of truth for tool name normalization.
 * Each agent provides its own mappings, but normalization logic is shared.
 */

import type { ToolStartEvent } from "../types/events"

/**
 * Canonical tool names used across all agents.
 * Consumers only see these names.
 */
export type CanonicalToolName =
  | "read"
  | "write"
  | "edit"
  | "glob"
  | "grep"
  | "shell"
  | "web_search"

/**
 * Reverse mapping: canonical -> display name (for UI)
 */
export const CANONICAL_DISPLAY_NAMES: Record<CanonicalToolName, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  shell: "Bash",
  web_search: "Web Search",
}

/**
 * Normalize a provider-specific tool name to canonical form.
 * Uses agent's mappings first, then falls back to lowercase.
 */
export function normalizeToolName(
  providerName: string,
  agentMappings: Record<string, string>
): string {
  return agentMappings[providerName] ?? providerName.toLowerCase()
}

/**
 * Get display name for a canonical tool name.
 */
export function getToolDisplayName(canonicalName: string): string {
  return (
    CANONICAL_DISPLAY_NAMES[canonicalName as CanonicalToolName] ?? canonicalName
  )
}

/**
 * Normalize tool input to a consistent format.
 * Extracts file_path from various field names.
 */
function normalizeToolInput(
  toolName: string,
  rawInput: unknown
): Record<string, unknown> {
  if (!rawInput || typeof rawInput !== "object") {
    return {}
  }

  const input = rawInput as Record<string, unknown>
  const result: Record<string, unknown> = { ...input }

  // Normalize file path field names
  if (
    toolName === "read" ||
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "glob" ||
    toolName === "grep"
  ) {
    const filePath =
      input.file_path ?? input.filePath ?? input.path ?? input.target
    if (filePath !== undefined) {
      result.file_path = filePath
    }
  }

  // Normalize command field for shell
  if (toolName === "shell") {
    const command = input.command ?? input.cmd ?? input.script
    if (command !== undefined) {
      result.command = command
    }
  }

  // Normalize pattern field for grep/glob
  if (toolName === "grep" || toolName === "glob") {
    const pattern = input.pattern ?? input.query ?? input.search
    if (pattern !== undefined) {
      result.pattern = pattern
    }
  }

  return result
}

/**
 * Create a normalized ToolStartEvent.
 * This is the single point for creating tool_start events.
 */
export function createToolStartEvent(
  name: string,
  rawInput: unknown,
  agentMappings: Record<string, string> = {}
): ToolStartEvent {
  const normalizedName = normalizeToolName(name, agentMappings)
  const normalizedInput = normalizeToolInput(normalizedName, rawInput)

  return {
    type: "tool_start",
    name: normalizedName,
    input: normalizedInput,
  }
}
