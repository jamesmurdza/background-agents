/**
 * Uninstall skills from a Daytona sandbox
 */

import type { Sandbox } from "@daytonaio/sdk"

/**
 * Uninstall a skill from a sandbox.
 *
 * Uses `npx skills remove` with -g (global/user-level scope) and --all -y for
 * non-interactive removal. -g matches the global install scope used by
 * installSkill so removals target ~/.agents/skills.
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Path to the repository in the sandbox
 * @param skillName - Name of the skill to remove
 *
 * @example
 * ```typescript
 * await uninstallSkill(sandbox, "/home/daytona/project", "vercel-react-best-practices")
 * ```
 */
export async function uninstallSkill(
  sandbox: Sandbox,
  repoPath: string,
  skillName: string
): Promise<void> {
  await sandbox.process.executeCommand(
    `cd ${repoPath} && npx -y skills remove ${skillName} -g --all 2>&1`
  )
}

/**
 * Extract the skill name from a fullHandle for uninstall.
 *
 * @param fullHandle - Full skill handle (e.g. "owner/repo/skill-name")
 * @returns Skill name for removal command
 */
export function getSkillNameFromHandle(fullHandle: string): string {
  const parts = fullHandle.split("/")
  return parts.length >= 3 ? parts.slice(2).join("/") : parts[parts.length - 1]
}
