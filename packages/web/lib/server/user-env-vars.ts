/**
 * Loading the env vars a chat's runs get (server-only). Apart from
 * lib/server/env-var-secrets so planning a turn's secrets needs no database.
 */

import { prisma } from "@/lib/db/prisma"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  chatEnvScope,
  decodeEnvVars,
  envVarSecretsOf,
  repoEnvScope,
  type EnvVarSecret,
  type EnvVarSet,
  type UserEnvVars,
} from "@/lib/server/env-var-secrets"

/**
 * The env vars a chat's runs get: the repo's (unless it's a new repo), then
 * the chat's, overriding. A chat var overriding a repo secret is a secret
 * only if marked so itself.
 */
export async function loadUserEnvVars(
  userId: string,
  chat: { id: string; repo: string; environmentVariables: unknown }
): Promise<UserEnvVars> {
  const scopes: [string, EnvVarSet][] = []
  if (chat.repo !== NEW_REPOSITORY) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { repoEnvironmentVariables: true } })
    const byRepo = user?.repoEnvironmentVariables as Record<string, unknown> | null
    scopes.push([repoEnvScope(chat.repo), decodeEnvVars(byRepo?.[chat.repo])])
  }
  scopes.push([chatEnvScope(chat.id), decodeEnvVars(chat.environmentVariables)])

  const values: Record<string, string> = {}
  const secrets = new Map<string, EnvVarSecret>()
  for (const [scope, set] of scopes) {
    Object.assign(values, set.values)
    for (const key of Object.keys(set.values)) secrets.delete(key)
    for (const secret of envVarSecretsOf(set, scope)) secrets.set(secret.key, secret)
  }
  return { values, secrets: [...secrets.values()] }
}
