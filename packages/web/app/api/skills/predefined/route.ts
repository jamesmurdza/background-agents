import { requireAuth, isAuthError } from "@/lib/db/api-helpers"
import { PREDEFINED_SKILLS, buildPredefinedSkillUrl } from "@background-agents/sandbox-skills"

// =============================================================================
// GET - List predefined (built-in) skills shipped by this app
// =============================================================================

export async function GET(): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult

  const results = PREDEFINED_SKILLS.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    fullHandle: `predefined/${skill.id}`,
    url: buildPredefinedSkillUrl(skill),
  }))

  return Response.json({ results })
}
