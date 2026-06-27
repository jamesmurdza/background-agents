/**
 * CLI output parsing utilities for skills commands
 */

import { stripAnsi } from "./ansi"

/**
 * Parse the output of `npx skills add <source> --list` to extract valid
 * skill names. Output format includes lines like:
 *   │    - skill-name
 */
export function parseSkillList(output: string): string[] {
  const cleaned = stripAnsi(output)
  const skills: string[] = []
  for (const line of cleaned.split("\n")) {
    const match = line.match(/[-–]\s+(\S+)\s*$/)
    if (match && match[1]) {
      skills.push(match[1])
    }
  }
  return skills
}

/**
 * Extract a clean, human-readable error from CLI output.
 * Looks for known error patterns instead of dumping the full banner.
 */
export function extractCleanError(raw: string): string {
  const cleaned = stripAnsi(raw)
  const noMatch = cleaned.match(/No matching skills found for:\s*(.+)/i)
  if (noMatch) return `Skill "${noMatch[1].trim()}" not found in this repository`
  if (cleaned.includes("Authentication failed"))
    return "Repository authentication failed"
  if (cleaned.includes("Installation failed")) return "Installation failed"
  return "Install failed"
}
