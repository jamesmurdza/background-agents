/**
 * @upstream/skills
 *
 * Skills registry client and sandbox operations for Daytona.
 *
 * This package provides:
 * - A registry client for searching Skills.sh
 * - Sandbox operations for installing/uninstalling skills
 * - Utilities for parsing CLI output
 *
 * Quick Start:
 * ```typescript
 * import { searchSkills } from "@upstream/skills/registry"
 * import { installSkill, uninstallSkill } from "@upstream/skills/sandbox"
 *
 * // Search for skills
 * const { results } = await searchSkills("react")
 *
 * // Install a skill (requires Daytona sandbox)
 * const result = await installSkill(sandbox, repoPath, "owner/repo", "skill-id")
 *
 * // Uninstall a skill
 * await uninstallSkill(sandbox, repoPath, "skill-id")
 * ```
 */

// Types
export type {
  SkillsApiResult,
  SkillSearchResult,
  SkillSearchResponse,
  SkillInstallResult,
  SkillsInstallResult,
  SkillRecord,
  DiscoveredSkill,
} from "./types"

// Registry client
export { searchSkills, SKILLS_API_BASE } from "./registry"

// Sandbox operations
export {
  listAvailableSkills,
  installSkill,
  installSkills,
  parseSkillHandle,
  uninstallSkill,
  getSkillNameFromHandle,
  discoverInstalledSkills,
  type OnSkillRemove,
} from "./sandbox"

// Utilities
export { stripAnsi, parseSkillList, extractCleanError } from "./utils"
