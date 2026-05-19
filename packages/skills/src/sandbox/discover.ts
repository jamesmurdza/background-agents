/**
 * Discover installed skills by scanning .agents/skills/ in the sandbox.
 *
 * Reads each SKILL.md file, extracts the name and description from YAML
 * frontmatter, and returns a lightweight catalog for the system prompt.
 */

import type { Sandbox } from "@daytonaio/sdk"
import type { DiscoveredSkill } from "../types"

/**
 * Parse YAML frontmatter from a SKILL.md file content.
 *
 * Extracts name and description from the block between leading `---` markers.
 * No external YAML parser — uses simple line-by-line parsing which is
 * sufficient for the flat key/value pairs defined in the spec.
 *
 * Returns null if the frontmatter is missing or description is absent
 * (per spec: skills without a description must be skipped).
 */
function parseFrontmatter(
  content: string
): { name: string; description: string } | null {
  const lines = content.split("\n")

  // Must start with ---
  if (lines[0]?.trim() !== "---") return null

  // Find closing ---
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) return null

  const frontmatterLines = lines.slice(1, closeIdx)

  let name = ""
  let description = ""

  for (const line of frontmatterLines) {
    // Simple key: value parsing — handles the required fields only
    const match = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (!match) continue
    const key = match[1]
    const value = match[2].trim().replace(/^["']|["']$/g, "") // strip optional quotes
    if (key === "name") name = value
    if (key === "description") description = value
  }

  if (!description) return null // spec: skip if no description

  return { name: name || "", description }
}

/**
 * Scan .agents/skills/ in the sandbox and return discovered skills.
 *
 * Each skill directory must contain a SKILL.md file. Only skills with a
 * valid name and description are returned; others are silently skipped.
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Absolute path to the repository in the sandbox
 * @returns Array of discovered skills (empty if none installed)
 */
export async function discoverInstalledSkills(
  sandbox: Sandbox,
  repoPath: string
): Promise<DiscoveredSkill[]> {
  const skillsDir = `${repoPath}/.agents/skills`

  // Find all SKILL.md files up to 3 levels deep (skill-name/SKILL.md)
  let findOutput: string
  try {
    const cmd = await sandbox.process.executeCommand(
      `find ${skillsDir} -maxdepth 3 -name "SKILL.md" 2>/dev/null`
    )
    findOutput = cmd.result?.trim() ?? ""
  } catch {
    // .agents/skills doesn't exist — no skills installed
    return []
  }

  if (!findOutput) return []

  const skillPaths = findOutput.split("\n").filter(Boolean)
  const discovered: DiscoveredSkill[] = []

  for (const skillMdPath of skillPaths) {
    try {
      const cmd = await sandbox.process.executeCommand(
        `cat "${skillMdPath}" 2>/dev/null`
      )
      const content = cmd.result ?? ""
      if (!content.trim()) continue

      const parsed = parseFrontmatter(content)
      if (!parsed) {
        console.warn(`[skills/discover] Skipping ${skillMdPath}: missing or invalid frontmatter`)
        continue
      }
      if (!parsed.description) {
        console.warn(`[skills/discover] Skipping ${skillMdPath}: missing description`)
        continue
      }

      // Use directory name as fallback name if frontmatter name is empty
      const dirName = skillMdPath.split("/").slice(-2, -1)[0] ?? ""
      discovered.push({
        name: parsed.name || dirName,
        description: parsed.description,
        location: skillMdPath,
      })
    } catch (err) {
      console.warn(`[skills/discover] Failed to read ${skillMdPath}:`, err)
    }
  }

  return discovered
}
