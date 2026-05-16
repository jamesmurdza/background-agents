/**
 * Skills package types
 */

// =============================================================================
// Registry Types (Skills.sh API)
// =============================================================================

/**
 * Raw response shape from Skills.sh API
 */
export interface SkillsApiResult {
  id: string // e.g. "vercel-labs/agent-skills/vercel-react-best-practices"
  skillId: string // e.g. "vercel-react-best-practices"
  name: string // e.g. "vercel-react-best-practices"
  installs: number // e.g. 378800
  source: string // e.g. "vercel-labs/agent-skills" (owner/repo)
}

/**
 * Normalized search result from Skills.sh registry
 */
export interface SkillSearchResult {
  publisher: string // e.g. "vercel-labs"
  name: string // e.g. "vercel-react-best-practices"
  fullHandle: string // e.g. "vercel-labs/agent-skills/vercel-react-best-practices"
  source: string // e.g. "vercel-labs/agent-skills" (owner/repo for install)
  skillId: string // e.g. "vercel-react-best-practices" (skill within repo)
  description: string
  url: string
  installs: number
}

/**
 * Search response from registry client
 */
export interface SkillSearchResponse {
  results: SkillSearchResult[]
  error?: string
}

// =============================================================================
// Sandbox Operation Types
// =============================================================================

/**
 * Result of installing a single skill
 */
export interface SkillInstallResult {
  fullHandle: string
  success: boolean
  error?: string
}

/**
 * Result of batch skill installation
 */
export interface SkillsInstallResult {
  installed: number
  total: number
  results: SkillInstallResult[]
}

/**
 * Skill record for installation (minimal fields needed)
 */
export interface SkillRecord {
  id: string
  fullHandle: string
}
