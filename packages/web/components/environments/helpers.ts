import { nanoid } from "nanoid"
import type { EnvVar } from "@/lib/types"
import type { EnvironmentDTO } from "@/lib/environments"

/**
 * Groups environments by repo, preserving the order the API returned them in
 * (repo asc, default first, name asc: see GET /api/environments). Object key
 * order in modern JS engines follows insertion order for non-numeric keys, so
 * this keeps repos in that same order without a separate sort.
 */
export function groupEnvironmentsByRepo(
  environments: EnvironmentDTO[]
): Record<string, EnvironmentDTO[]> {
  return environments.reduce<Record<string, EnvironmentDTO[]>>((acc, env) => {
    ;(acc[env.repo] ??= []).push(env)
    return acc
  }, {})
}

/** Convert a Record<string, string> to EnvVar[] for UI display. Mirrors the
 *  same conversion in EnvironmentVariablesModal so both editors behave alike. */
export function recordToEnvVars(record: Record<string, string>): EnvVar[] {
  return Object.entries(record).map(([key, value]) => ({
    id: nanoid(),
    key,
    value,
  }))
}

/** Convert EnvVar[] to Record<string, string> for the API. Empty keys are
 *  dropped; the last entry for a duplicate key wins. */
export function envVarsToRecord(envVars: EnvVar[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const { key, value } of envVars) {
    if (key.trim()) {
      record[key.trim()] = value
    }
  }
  return record
}

/** A plain, renamable default name for a newly created environment: the
 *  editor's name field is the place to actually name it, so this only needs
 *  to be the first "New environment N" (starting at 1) not already taken by
 *  a sibling in that repo. Names are compared trimmed and case-insensitively,
 *  so "new environment 1" or " New environment 1 " both count as taken. */
export function nextEnvironmentName(existingNames: string[]): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()))
  let n = 1
  while (taken.has(`new environment ${n}`)) {
    n++
  }
  return `New environment ${n}`
}
