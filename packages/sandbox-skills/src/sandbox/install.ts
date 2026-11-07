/**
 * Install skills into a Daytona sandbox
 */

import { randomUUID } from "node:crypto"
import type { Sandbox } from "@daytonaio/sdk"
import type { SkillRecord, SkillInstallResult, SkillsInstallResult, SkillBatchResult } from "../types"
import { extractCleanError } from "../utils"
import { listAvailableSkills } from "./list"
import { parseFrontmatter } from "./discover"

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
    // -g installs at user-level (~/.agents/skills) instead of into the repo
    // working tree, so the repository stays clean and skills are shared.
    const installCmd = `npx -y skills add ${source}${skillFlag} --agent '*' -g -y`
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

/** Uploaded skill names end up in shell commands, so only allow safe characters. */
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Single-quote a path for the sandbox shell (folder names come from the zip). */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Install an uploaded skill from a zip. The zip holds one skill: a SKILL.md
 * (at the top level or inside one folder) and the files it uses.
 *
 * The zip is unpacked in the sandbox and installed with the same
 * `skills add` command as skills.sh skills, using the local folder as the
 * source. The returned fullHandle is "upload/<name>", with the name taken
 * from SKILL.md.
 */
export async function installSkillArchive(
  sandbox: Sandbox,
  repoPath: string,
  archive: Uint8Array
): Promise<SkillInstallResult> {
  const dir = `/tmp/skill-upload-${randomUUID()}`
  const failed = (error: string): SkillInstallResult => ({ fullHandle: "upload", success: false, error })

  try {
    await sandbox.process.executeCommand(`mkdir -p ${dir}`)
    await sandbox.fs.uploadFile(Buffer.from(archive), `${dir}/skill.zip`)
    // unzip drops "../" path components, so the files stay inside the folder.
    const unzip = await sandbox.process.executeCommand(
      `cd ${dir} && unzip -q -o skill.zip -d files 2>&1 && find files -maxdepth 2 -name SKILL.md`
    )
    if (unzip.exitCode !== 0) return failed("Could not unzip the file")

    const found = (unzip.result ?? "").trim().split("\n").filter(Boolean)
    if (found.length !== 1) return failed("The zip must contain exactly one SKILL.md")

    const skillMd = await sandbox.process.executeCommand(`cat ${quote(`${dir}/${found[0]}`)}`)
    const meta = parseFrontmatter(skillMd.result ?? "")
    if (!meta?.name || !SAFE_SKILL_NAME.test(meta.name)) {
      return failed("SKILL.md needs a description and a name using only letters, numbers, dots, dashes or underscores")
    }

    const skillDir = `${dir}/${found[0].replace(/\/?SKILL\.md$/, "")}`
    const result = await installSkill(sandbox, repoPath, quote(skillDir))
    return { ...result, fullHandle: `upload/${meta.name}` }
  } catch (error) {
    return failed(error instanceof Error ? error.message : "Unknown error")
  } finally {
    // Best-effort cleanup: a leftover temp folder doesn't affect the install.
    await sandbox.process.executeCommand(`rm -rf ${dir}`).catch((error) => {
      console.warn("[skills/install] Could not remove the upload folder:", error)
    })
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
    return { installed: 0, total: 0, results: [], batchResults: [] }
  }

  const results: SkillInstallResult[] = []
  const batchResults: SkillBatchResult[] = []

  // Cache --list results per source repo so we only clone once per repo
  const availableSkillsCache = new Map<string, Set<string> | null>()

  for (const skill of skills) {
    if (skill.archive) {
      // Uploaded skills can't be fetched again, so keep the record if this fails.
      const result = await installSkillArchive(sandbox, repoPath, skill.archive)
      results.push(result)
      batchResults.push({
        id: skill.id,
        fullHandle: result.fullHandle,
        status: result.success ? "installed" : "failed",
        error: result.error,
      })
      continue
    }

    const { source, skillId } = parseSkillHandle(skill.fullHandle)

    // If there's a specific skillId, validate it exists in the repo
    if (skillId) {
      if (!availableSkillsCache.has(source)) {
        const available = await listAvailableSkills(sandbox, repoPath, source)
        availableSkillsCache.set(source, available)
      }

      const available = availableSkillsCache.get(source)
      if (available && !available.has(skillId)) {
        // Skill is confirmed absent from the repo's skill list — skip install
        // and let the caller clean up the now-invalid record.
        const errorMsg = `Skill "${skillId}" not found in ${source}. Available: ${[...available].slice(0, 5).join(", ")}${available.size > 5 ? "..." : ""}`
        results.push({
          fullHandle: skill.fullHandle,
          success: false,
          error: errorMsg,
        })
        batchResults.push({
          id: skill.id,
          fullHandle: skill.fullHandle,
          status: "not-found",
          error: errorMsg,
        })

        // Notify caller to clean up the invalid record
        if (onRemove) {
          await onRemove(skill.id).catch(() => {})
        }
        continue
      }
    }

    // Validated (or the list check was inconclusive/null) — proceed with install
    const result = await installSkill(sandbox, repoPath, source, skillId)
    results.push(result)
    batchResults.push({
      id: skill.id,
      fullHandle: result.fullHandle,
      status: result.success ? "installed" : "failed",
      error: result.error,
    })

    // Do NOT remove the DB record here: the skill was found in the available
    // list (or the list check itself failed/was inconclusive), so a failed
    // install exec is treated as a transient failure (sandbox not fully
    // ready, npx cold-start, network blip, etc.), not confirmation that the
    // skill doesn't exist. installSkill() already retries internally.
  }

  const installed = results.filter((r) => r.success).length
  return { installed, total: skills.length, results, batchResults }
}
