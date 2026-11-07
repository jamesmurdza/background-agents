/**
 * Shared pool keys via Daytona secrets (server-only).
 *
 * A shared pool key (see lib/server/shared-key-pools) is never handed to a
 * sandbox. Instead a Daytona secret is mounted on it as the pool's
 * `mountEnv`: the sandbox sees only an opaque placeholder, and Daytona's
 * egress proxy substitutes the real key on HTTPS requests to the pool's
 * hosts. Printing the env, reading `/proc/<pid>/environ` or running `ps aux`
 * inside the sandbox reveals nothing usable outside it. This module decides
 * which pool secret a run uses; lib/server/turn-secrets mounts it with the
 * rest of the turn's secrets, for the duration of the turn only.
 *
 * The secrets themselves are created from the pool's env var on first use
 * ({@link ensureSharedPoolSecret}), so there is nothing to set up in the
 * Daytona dashboard.
 */

import type { Daytona } from "@daytonaio/sdk"
import { modelRequiresKey, type Agent } from "@background-agents/common"
import { ensureSecret, parseSecretMarker, type EnsuredSecret } from "@background-agents/sandbox-secrets"

import type { Credentials } from "@/lib/credentials"
import {
  sharedKeyForSecret,
  sharedPoolForProvider,
  sharedPoolForSecret,
  type SharedKeyPool,
} from "@/lib/server/shared-key-pools"

function requirePool(secretName: string): SharedKeyPool {
  const pool = sharedPoolForSecret(secretName)
  if (!pool) throw new Error(`Secret ${secretName} belongs to no shared key pool`)
  return pool
}

/**
 * The secret this run would mount, or undefined when the run doesn't draw on
 * a shared pool (own key, free model, a provider without a pool).
 */
export function sharedPoolSecretForRun(
  credentials: Credentials,
  agent: Agent,
  model: string | undefined
): string | undefined {
  const pool = sharedPoolForProvider(modelRequiresKey(agent, model))
  return pool && parseSecretMarker(credentials[pool.envKey])
}

/**
 * Make sure the Daytona secret `secretName` exists, creating it from the pool
 * key it was derived from if not, and return its placeholder. Call before
 * creating a sandbox with the secret or mounting it. Throws if the secret
 * can't be confirmed or created, e.g. when the Daytona API key lacks
 * permission to manage secrets.
 */
export async function ensureSharedPoolSecret(daytona: Daytona, secretName: string): Promise<EnsuredSecret> {
  const pool = requirePool(secretName)
  return ensureSecret(daytona, {
    name: secretName,
    value: () => {
      const key = sharedKeyForSecret(secretName)
      if (!key) throw new Error(`No configured ${pool.label} key matches secret ${secretName}`)
      return key
    },
    hosts: pool.hosts,
    description: `Shared ${pool.label} key, created by background-agents`,
  })
}
