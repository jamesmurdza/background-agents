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

/**
 * Secrets confirmed (or being confirmed) to exist this process lifetime, so
 * only the first call per name pays for the lookup. A failed attempt is
 * forgotten, so the next call retries it.
 */
const ensuredSecrets = new Map<string, Promise<void>>()

/**
 * Make sure the Daytona secret `spec.name` exists, creating it if not. An
 * existing secret is never updated: names are meant to be derived from the
 * value, so an existing one already holds it. Call before creating a sandbox
 * with the secret or mounting it. Throws if the secret can't be confirmed or
 * created, e.g. when the Daytona API key lacks permission to manage secrets.
 */
export function ensureSecret(daytona: Daytona, spec: EnsureSecretSpec): Promise<void> {
  let ensured = ensuredSecrets.get(spec.name)
  if (!ensured) {
    ensured = createSecretIfMissing(daytona, spec)
    ensuredSecrets.set(spec.name, ensured)
    ensured.catch(() => ensuredSecrets.delete(spec.name))
  }
  return ensured
}

async function createSecretIfMissing(daytona: Daytona, spec: EnsureSecretSpec): Promise<void> {
  const value = spec.value()

  // `name` is a partial-match filter, hence the exact comparison.
  const { items } = await daytona.secret.list({ name: spec.name })
  if (items.some((secret) => secret.name === spec.name)) return

  try {
    await daytona.secret.create({
      name: spec.name,
      value,
      description: spec.description,
      hosts: spec.hosts,
    })
    console.log(`[sandbox-secrets] created Daytona secret ${spec.name}`)
  } catch (err) {
    // Another process created it between our list and create.
    if (err instanceof DaytonaConflictError) return
    throw err
  }
}
