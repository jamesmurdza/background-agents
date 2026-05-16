/**
 * List available skills in a sandbox
 */

import type { Sandbox } from "@daytonaio/sdk"
import { parseSkillList } from "../utils"

/**
 * Run `npx skills add <source> --list` in the sandbox to discover which
 * skills are actually available in the repo.
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Path to the repository in the sandbox
 * @param source - Source repository (e.g. "owner/repo")
 * @returns Set of valid skill names, or null if the list command failed
 *
 * @example
 * ```typescript
 * const available = await listAvailableSkills(sandbox, "/home/daytona/project", "vercel-labs/agent-skills")
 * if (available?.has("vercel-react-best-practices")) {
 *   // Skill exists, safe to install
 * }
 * ```
 */
export async function listAvailableSkills(
  sandbox: Sandbox,
  repoPath: string,
  source: string
): Promise<Set<string> | null> {
  try {
    const cmd = await sandbox.process.executeCommand(
      `cd ${repoPath} && npx -y skills add ${source} --list 2>&1`
    )
    if (cmd.exitCode !== 0 && !cmd.result?.includes("Found")) {
      console.error(
        `[skills/sandbox] --list failed for ${source}:`,
        cmd.result?.trim()
      )
      return null
    }
    const names = parseSkillList(cmd.result ?? "")
    return names.length > 0 ? new Set(names) : null
  } catch (err) {
    console.error(`[skills/sandbox] --list error for ${source}:`, err)
    return null
  }
}
