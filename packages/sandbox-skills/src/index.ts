/**
 * @background-agents/sandbox-skills
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
 * import { searchSkills } from "@background-agents/sandbox-skills/registry"
 * import { installSkill, uninstallSkill } from "@background-agents/sandbox-skills/sandbox"
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
  installPredefinedSkill,
  type OnSkillRemove,
} from "./sandbox"

// Predefined (built-in) skills manifest
export {
  PREDEFINED_SKILLS,
  PREDEFINED_SKILLS_REPO,
  predefinedSkillsBranch,
  getPredefinedSkill,
  buildPredefinedSkillUrl,
  type PredefinedSkill,
} from "./predefined-skills"

// Utilities
export { stripAnsi, parseSkillList, extractCleanError } from "./utils"
