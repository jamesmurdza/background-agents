/**
 * Install predefined (built-in) skills into a Daytona sandbox.
 *
 * Reuses `installSkill` as-is — a predefined skill is just a `skills add`
 * source that happens to be a GitHub tree URL pointing back at this repo's
 * own `packages/predefined-skills/<id>` folder, instead of a third-party
 * `owner/repo` handle from the skills.sh marketplace.
 */

import type { Sandbox } from "@daytonaio/sdk"
import type { SkillInstallResult } from "../types"
import { getPredefinedSkill, buildPredefinedSkillUrl } from "../predefined-skills"
import { installSkill } from "./install"

/**
 * Install one predefined skill by id (see `PREDEFINED_SKILLS`).
 *
 * @param sandbox - Daytona sandbox instance
 * @param repoPath - Path to the repository in the sandbox
 * @param skillId - id from the predefined skills manifest (e.g. "browser-mirror")
 * @returns Installation result, with `fullHandle` of the form `predefined/<id>`
 *
 * @example
 * ```typescript
 * const result = await installPredefinedSkill(sandbox, "/home/daytona/project", "browser-mirror")
 * if (result.success) {
 *   console.log("Installed:", result.fullHandle) // "predefined/browser-mirror"
 * }
 * ```
 */
export async function installPredefinedSkill(
  sandbox: Sandbox,
  repoPath: string,
  skillId: string
): Promise<SkillInstallResult> {
  const skill = getPredefinedSkill(skillId)
  if (!skill) {
    return {
      fullHandle: `predefined/${skillId}`,
      success: false,
      error: `Unknown predefined skill: "${skillId}"`,
    }
  }

  const url = buildPredefinedSkillUrl(skill)
  const result = await installSkill(sandbox, repoPath, url)
  return { ...result, fullHandle: `predefined/${skill.id}` }
}
