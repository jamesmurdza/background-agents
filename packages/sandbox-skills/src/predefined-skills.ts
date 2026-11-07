/**
 * Manifest of predefined (built-in) skills shipped by this app.
 *
 * The actual skill content (SKILL.md + assets) lives in the
 * `@background-agents/predefined-skills` package, one folder per skill:
 *
 *   packages/predefined-skills/<path>/SKILL.md
 *
 * Installing one reuses the exact same mechanism as any skills.sh skill —
 * `skills add <source>` — by pointing `source` at this repo's own GitHub
 * tree URL for that subdirectory. No separate upload/bundling step needed;
 * the sandbox just clones/fetches straight from GitHub.
 */

/** This repo, as `owner/repo`. Used to build GitHub tree URLs below. */
export const PREDEFINED_SKILLS_REPO = "jamesmurdza/background-agents"

/**
 * Branch (or tag/commit) to fetch predefined skills from.
 *
 * Defaults to "main". Override with the `PREDEFINED_SKILLS_BRANCH` env var
 * while this is still unmerged — e.g. set it to the PR's branch name so
 * installs resolve during review, then unset it (or leave it unset) once
 * this lands on main.
 */
export function predefinedSkillsBranch(): string {
  return process.env.PREDEFINED_SKILLS_BRANCH || "main"
}

export interface PredefinedSkill {
  /** Stable id used in the manifest and in stored fullHandles (`predefined/<id>`). */
  id: string
  /** Display name, matches the `name` in the skill's SKILL.md frontmatter. */
  name: string
  /** Short description, matches the `description` in the skill's SKILL.md frontmatter. */
  description: string
  /** Path to the skill's folder, relative to the repo root. */
  path: string
}

/**
 * Static manifest of predefined skills. Keep in sync with the folders under
 * `packages/predefined-skills/`. There's no filesystem scan at runtime
 * because this list needs to be available in places (e.g. the web app)
 * that don't have this repo checked out — only the GitHub source is fetched
 * by the sandbox at install time.
 */
export const PREDEFINED_SKILLS: PredefinedSkill[] = [
  {
    id: "browser-mirror",
    name: "browser-mirror",
    description:
      "Run a headless browser and mirror what it's doing live to a webpage on a local port, so a human can watch browser automation happen in real time.",
    path: "packages/predefined-skills/browser-mirror",
  },
]

/** Look up a predefined skill by id, or undefined if it doesn't exist. */
export function getPredefinedSkill(id: string): PredefinedSkill | undefined {
  return PREDEFINED_SKILLS.find((skill) => skill.id === id)
}

/**
 * Build the GitHub tree URL for a predefined skill's subdirectory — the
 * `source` the `skills` CLI expects for "direct path to a skill in a repo".
 */
export function buildPredefinedSkillUrl(skill: PredefinedSkill, branch = predefinedSkillsBranch()): string {
  return `https://github.com/${PREDEFINED_SKILLS_REPO}/tree/${branch}/${skill.path}`
}
