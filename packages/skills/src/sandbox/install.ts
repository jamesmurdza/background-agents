/**
 * Install skills into a Daytona sandbox
 */

import type { Sandbox } from "@daytonaio/sdk"
import type { SkillRecord, SkillInstallResult, SkillsInstallResult } from "../types"
import { extractCleanError } from "../utils"
import { listAvailableSkills } from "./list"

/**
 * Parse a skill's fullHandle into source and skillId components.
 *
 * @param fullHandle - Full skill handle (e.g. "owner/repo/skill-name")
 * @returns Object with source ("owner/repo") and skillId ("skill-name")
 */
export function parseSkillHandle(fullHandle: string): {
  source: string
  skillId: string | null
} {
  const parts = fullHandle.split("/")
  const source = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : fullHandle
  const skillId = parts.length >= 3 ? parts.slice(2).join("/") : null
  return { source, skillId }
}

/**
 * Install a single skill into a sandbox.
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Path to the repository in the sandbox
 * @param source - Source repository (e.g. "owner/repo")
 * @param skillId - Specific skill ID within the repo (optional)
 * @returns Installation result
 *
 * @example
 * ```typescript
 * const result = await installSkill(
 *   sandbox,
 *   "/home/daytona/project",
 *   "vercel-labs/agent-skills",
 *   "vercel-react-best-practices"
 * )
 * if (result.success) {
 *   console.log("Installed:", result.fullHandle)
 * }
 * ```
 */
export async function installSkill(
  sandbox: Sandbox,
  repoPath: string,
  source: string,
  skillId?: string | null
): Promise<SkillInstallResult> {
  const fullHandle = skillId ? `${source}/${skillId}` : source

  try {
    const skillFlag = skillId ? ` --skill ${skillId}` : ""
    const installCmd = `npx -y skills add ${source}${skillFlag} --agent '*' -y`
    const cmd = await sandbox.process.executeCommand(
      `cd ${repoPath} && ${installCmd} 2>&1`
    )

    const success = cmd.exitCode === 0
    return {
      fullHandle,
      success,
      error: success ? undefined : extractCleanError(cmd.result ?? ""),
    }
  } catch (error) {
    return {
      fullHandle,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Callback for when a skill should be removed (e.g. stale DB record).
 * Called when a skill fails validation or installation.
 */
export type OnSkillRemove = (skillId: string) => Promise<void>

/**
 * Install multiple skills into a sandbox with pre-validation.
 *
 * Pre-validates each skill via --list to avoid installing stale/renamed skills.
 * Caches --list results per source repo so we only clone once per repo.
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Path to the repository in the sandbox
 * @param skills - Array of skill records to install
 * @param onRemove - Optional callback when a skill should be removed (stale/invalid)
 * @returns Batch installation results
 *
 * @example
 * ```typescript
 * const skills = [
 *   { id: "1", fullHandle: "vercel-labs/agent-skills/vercel-react-best-practices" },
 *   { id: "2", fullHandle: "owner/repo/another-skill" }
 * ]
 *
 * const result = await installSkills(sandbox, "/home/daytona/project", skills, async (id) => {
 *   await prisma.skill.delete({ where: { id } })
 * })
 *
 * console.log(`Installed ${result.installed}/${result.total} skills`)
 * ```
 */
export async function installSkills(
  sandbox: Sandbox,
  repoPath: string,
  skills: SkillRecord[],
  onRemove?: OnSkillRemove
): Promise<SkillsInstallResult> {
  if (skills.length === 0) {
    return { installed: 0, total: 0, results: [] }
  }

  const results: SkillInstallResult[] = []

  // Cache --list results per source repo so we only clone once per repo
  const availableSkillsCache = new Map<string, Set<string> | null>()

  for (const skill of skills) {
    const { source, skillId } = parseSkillHandle(skill.fullHandle)

    // If there's a specific skillId, validate it exists in the repo
    if (skillId) {
      if (!availableSkillsCache.has(source)) {
        const available = await listAvailableSkills(sandbox, repoPath, source)
        availableSkillsCache.set(source, available)
      }

      const available = availableSkillsCache.get(source)
      if (available && !available.has(skillId)) {
        // Skill doesn't exist in the repo — skip install
        const errorMsg = `Skill "${skillId}" not found in ${source}. Available: ${[...available].slice(0, 5).join(", ")}${available.size > 5 ? "..." : ""}`
        results.push({
          fullHandle: skill.fullHandle,
          success: false,
          error: errorMsg,
        })

        // Notify caller to clean up the invalid record
        if (onRemove) {
          await onRemove(skill.id).catch(() => {})
        }
        continue
      }
    }

    // Validated — proceed with install
    const result = await installSkill(sandbox, repoPath, source, skillId)
    results.push(result)

    // Clean up DB record if install failed
    if (!result.success && onRemove) {
      await onRemove(skill.id).catch(() => {})
    }
  }

  const installed = results.filter((r) => r.success).length
  return { installed, total: skills.length, results }
}
