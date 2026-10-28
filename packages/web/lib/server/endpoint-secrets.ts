/**
 * Custom endpoint credentials via Daytona secrets (server-only).
 *
 * A custom endpoint's auth headers reach the sandbox in several env vars at
 * once — the promoted key (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN,
 * CUSTOM_CODEX_AUTHORIZATION, CUSTOM_OPENCODE_API_KEY) and the raw header
 * blob the SDK writes into the CLI's config. Each credential is instead put
 * behind a Daytona secret allowed only on the endpoint's host, and swapped
 * for its placeholder wherever it appears (see lib/server/turn-secrets).
 *
 * A credential is the value of any header whose name says it is one
 * ({@link CREDENTIAL_HEADER}), minus a `Bearer ` prefix. Other headers pass
 * through as they are. An endpoint that isn't plain HTTPS on the default
 * port keeps its credentials as they are: the proxy only intercepts HTTPS,
 * and a secret's hosts can't name a port.
 *
 * Off unless DAYTONA_USER_KEY_SECRETS includes CUSTOM_ENDPOINTS (or is "all").
 */

import { Daytona } from "@daytonaio/sdk"
import {
  contentSecretName,
  deleteSecrets,
  ensureSecret,
  type EnsureSecretSpec,
} from "@background-agents/sandbox-secrets"
import type { CustomEndpoint } from "@background-agents/common"

import { userKeySecretPrefix } from "@/lib/server/user-key-secrets"

/** Header names whose values are credentials. */
const CREDENTIAL_HEADER = /authorization|api[-_]?key|token|secret/i

/** DAYTONA_USER_KEY_SECRETS entry that turns endpoint secrets on. */
const FLAG = "CUSTOM_ENDPOINTS"

export function endpointSecretsEnabled(): boolean {
  const enabled = (process.env.DAYTONA_USER_KEY_SECRETS ?? "").split(",").map((s) => s.trim())
  return enabled.includes("all") || enabled.includes(FLAG)
}

/**
 * The host an endpoint's credentials may be sent to, or undefined when its
 * base URL isn't HTTPS on the default port.
 */
export function endpointSecretHost(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "https:" || url.port) return undefined
    return url.hostname
  } catch {
    return undefined
  }
}

/** The credential values in an endpoint's headers, `Bearer ` stripped, in order. */
export function endpointCredentials(endpoint: CustomEndpoint): string[] {
  const values: string[] = []
  for (const line of (endpoint.headers ?? "").split("\n")) {
    if (line.trim().startsWith("#")) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    if (!CREDENTIAL_HEADER.test(line.slice(0, idx).trim())) continue
    const value = line.slice(idx + 1).trim().replace(/^Bearer\s+/i, "").trim()
    if (value && !values.includes(value)) values.push(value)
  }
  return values
}

/** Prefix of every endpoint secret of `userId`'s. */
export function endpointSecretPrefix(userId: string): string {
  return `${userKeySecretPrefix(userId)}ep_`
}

/**
 * The secret holding `value` for an endpoint on `host`. The host is part of
 * the name because it is fixed when the secret is created.
 */
export function endpointSecretSpec(userId: string, host: string, value: string): EnsureSecretSpec {
  return {
    name: contentSecretName(endpointSecretPrefix(userId), `${host}\n${value}`),
    value: () => value,
    hosts: [host],
    description: "Custom endpoint credential of a background-agents user",
  }
}

/** Every secret `endpoints` need, one per credential. */
export function endpointSecretSpecs(userId: string, endpoints: CustomEndpoint[]): EnsureSecretSpec[] {
  const specs: EnsureSecretSpec[] = []
  for (const endpoint of endpoints) {
    const host = endpointSecretHost(endpoint.baseUrl)
    if (!host) continue
    for (const value of endpointCredentials(endpoint)) specs.push(endpointSecretSpec(userId, host, value))
  }
  return specs
}

/**
 * Bring a user's endpoint secrets in line with a just-saved endpoint list:
 * create what the list needs and delete the rest. Never throws: the next
 * turn creates what's missing, and a stale secret only costs storage.
 */
export async function syncEndpointSecrets(userId: string, endpoints: CustomEndpoint[]): Promise<void> {
  if (!endpointSecretsEnabled()) return
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) return
  const daytona = new Daytona({ apiKey })
  try {
    const keep: string[] = []
    for (const spec of endpointSecretSpecs(userId, endpoints)) keep.push((await ensureSecret(daytona, spec)).name)
    await deleteSecrets(daytona, { prefix: endpointSecretPrefix(userId), keep })
  } catch (err) {
    console.error("[endpoint-secrets] failed to sync custom endpoint secrets:", err)
  }
}
