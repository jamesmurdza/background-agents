/**
 * Goose CLI output parser
 *
 * Pure function for parsing Goose CLI JSON output.
 * No state, no side effects - easily testable.
 */

import type { Event } from "../../types/events.js"

/**
 * Parse a line of Goose CLI output into event(s).
 *
 * @param line - Raw line from CLI output
 * @param toolMappings - Tool name mappings for this agent
 * @returns Event, array of events, or null if line should be ignored
 */
export function parseGooseLine(
  _line: string,
  _toolMappings: Record<string, string>
): Event | Event[] | null {
  return null
}
