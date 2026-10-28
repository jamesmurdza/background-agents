import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

export interface EnsureSecretSpec {
  /** The secret's name (see {@link contentSecretName}). */
  name: string
  /**
   * Returns the value to create the secret with. Called before anything else,
   * so it may throw to refuse a name it doesn't recognise.
   */
  value: () => string
  /** Hosts the value may be sent to. Omit to leave the secret unrestricted. */
  hosts?: string[]
  description?: string
}

export interface EnsuredSecret {
  name: string
  /**
   * The opaque token the proxy swaps for the real value. The same in every
   * sandbox and useless where the secret isn't mounted, so it can be handed
   * to a process directly (e.g. as its API key) instead of read from the
   * mounted env var.
   */
  placeholder: string
}

/**
 * Secrets confirmed (or being confirmed) to exist this process lifetime, so
 * only the first call per name pays for the lookup. A failed attempt is
 * forgotten, so the next call retries it.
 */
const ensuredSecrets = new Map<string, Promise<EnsuredSecret>>()

/**
 * Make sure the Daytona secret `spec.name` exists, creating it if not, and
 * return its placeholder. An existing secret is never updated: names are meant
 * to be derived from the value, so an existing one already holds it. Call
 * before creating a sandbox with the secret or mounting it. Throws if the
 * secret can't be confirmed or created, e.g. when the Daytona API key lacks
 * permission to manage secrets.
 */
export function ensureSecret(daytona: Daytona, spec: EnsureSecretSpec): Promise<EnsuredSecret> {
  let ensured = ensuredSecrets.get(spec.name)
  if (!ensured) {
    ensured = createSecretIfMissing(daytona, spec)
    ensuredSecrets.set(spec.name, ensured)
    ensured.catch(() => ensuredSecrets.delete(spec.name))
  }
  return ensured
}

async function findSecret(daytona: Daytona, name: string): Promise<EnsuredSecret | undefined> {
  // `name` is a partial-match filter, hence the exact comparison.
  const { items } = await daytona.secret.list({ name })
  const secret = items.find((s) => s.name === name)
  return secret && { name, placeholder: secret.placeholder }
}

async function createSecretIfMissing(daytona: Daytona, spec: EnsureSecretSpec): Promise<EnsuredSecret> {
  const value = spec.value()

  const existing = await findSecret(daytona, spec.name)
  if (existing) return existing

  try {
    const created = await daytona.secret.create({
      name: spec.name,
      value,
      description: spec.description,
      hosts: spec.hosts,
    })
    console.log(`[sandbox-secrets] created Daytona secret ${spec.name}`)
    return { name: spec.name, placeholder: created.placeholder }
  } catch (err) {
    if (!(err instanceof DaytonaConflictError)) throw err
    // Another process created it between our list and create.
    const raced = await findSecret(daytona, spec.name)
    if (!raced) throw err
    return raced
  }
}
