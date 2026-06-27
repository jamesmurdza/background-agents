/**
 * Skills.sh registry API client
 */

import type { SkillsApiResult, SkillSearchResult, SkillSearchResponse } from "../types"
import { SKILLS_API_BASE } from "./constants"

/**
 * Search for skills in the Skills.sh registry
 *
 * @param query - Search query string
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 * @returns Search results or error
 *
 * @example
 * ```typescript
 * const { results, error } = await searchSkills("react")
 * if (error) {
 *   console.error("Search failed:", error)
 * } else {
 *   console.log("Found skills:", results)
 * }
 * ```
 */
export async function searchSkills(
  query: string,
  timeoutMs = 10000
): Promise<SkillSearchResponse> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return { results: [], error: "Search query is required" }
  }

  try {
    const apiUrl = new URL("/api/search", SKILLS_API_BASE)
    apiUrl.searchParams.set("q", trimmedQuery)

    const response = await fetch(apiUrl.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      console.error(
        `[skills/registry] Skills.sh API error: ${response.status} ${response.statusText}`
      )
      return { results: [], error: "Skills registry unavailable" }
    }

    const data = (await response.json()) as { skills?: SkillsApiResult[] }

    // Normalize the response into our SkillSearchResult shape
    // source = "owner/repo", skillId = skill name within that repo
    // fullHandle = "owner/repo/skillId" — unique per skill
    // install via: npx skills add owner/repo --skill skillId
    const results: SkillSearchResult[] = (data.skills ?? []).map(
      (item: SkillsApiResult) => {
        const source = item.source ?? ""
        const skillId = item.skillId ?? item.name ?? ""
        return {
          publisher: source.split("/")[0] ?? "",
          name: item.name ?? skillId,
          fullHandle: `${source}/${skillId}`, // unique key: "owner/repo/skillId"
          source, // "owner/repo" for install command
          skillId, // individual skill within the repo
          description: "",
          url: `https://skills.sh/skills/${source}/${skillId}`,
          installs: item.installs ?? 0,
        }
      }
    )

    return { results }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { results: [], error: "Skills registry timed out" }
    }
    console.error("[skills/registry] Search error:", error)
    return {
      results: [],
      error: error instanceof Error ? error.message : "Search failed",
    }
  }
}
