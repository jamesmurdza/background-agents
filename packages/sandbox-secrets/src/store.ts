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
 * How long a process trusts that a secret it ensured still exists before
 * checking again, which also renews the secret's "last used" stamp
 * ({@link secretLastUsedAt}). A sweep that deletes secrets unused for longer
 * than this can't strand a process that still thinks one exists: it would
 * have checked, and stamped it, in the meantime.
 */
export const REVERIFY_MS = 6 * 60 * 60 * 1000

/**
 * Secrets confirmed (or being confirmed) to exist, and when, so only the
 * first call per name in {@link REVERIFY_MS} pays for the lookup. A failed
 * attempt is forgotten, so the next call retries it.
 */
const ensuredSecrets = new Map<string, { ensured: Promise<EnsuredSecret>; at: number }>()

/** Trailing `[used <ISO time>]` in a secret's description. */
const USED_STAMP = /\s*\[used ([^\]]+)\]$/

/** `description` with its "last used" stamp set to `at`. */
export function stampLastUsed(description: string | undefined, at: number): string {
  const base = (description ?? "").replace(USED_STAMP, "")
  return `${base}${base ? " " : ""}[used ${new Date(at).toISOString()}]`
}

/**
 * When a secret was last ensured by {@link ensureSecret} (at most
 * {@link REVERIFY_MS} ago while in use), from its description's stamp;
 * its creation time when it has none.
 */
export function secretLastUsedAt(secret: { description?: string; createdAt: Date | string }): number {
  const created = new Date(secret.createdAt).getTime()
  const stamp = secret.description?.match(USED_STAMP)?.[1]
  const used = stamp ? Date.parse(stamp) : NaN
  return Number.isNaN(used) ? created : Math.max(used, created)
}

/**
 * Make sure the Daytona secret `spec.name` exists, creating it if not, and
 * return its placeholder. An existing secret's value is never updated: names
 * are meant to be derived from the value, so an existing one already holds
 * it. Only its description is, to stamp it as used (see
 * {@link secretLastUsedAt}). Call before creating a sandbox with the secret
 * or mounting it. Throws if the secret can't be confirmed or created, e.g.
 * when the Daytona API key lacks permission to manage secrets.
 */
export function ensureSecret(daytona: Daytona, spec: EnsureSecretSpec): Promise<EnsuredSecret> {
  const now = Date.now()
  const known = ensuredSecrets.get(spec.name)
  if (known && now - known.at < REVERIFY_MS) return known.ensured
  const ensured = createSecretIfMissing(daytona, spec, now)
  ensuredSecrets.set(spec.name, { ensured, at: now })
  ensured.catch(() => {
    if (ensuredSecrets.get(spec.name)?.ensured === ensured) ensuredSecrets.delete(spec.name)
  })
  return ensured
}

/**
 * Forget that `names` were ensured, so the next {@link ensureSecret} for each
 * checks Daytona again. For when one may have been deleted behind this
 * process's back, e.g. after a mount naming it was rejected.
 */
export function forgetSecrets(names: Iterable<string>): void {
  for (const name of names) ensuredSecrets.delete(name)
}

/**
 * Delete every secret whose name starts with `prefix`, except those in
 * `keep` and the `keepNewest` most recently created, and return the names
 * deleted. A sandbox with one of them mounted stops getting it swapped within
 * about half a minute, and stays up.
 *
 * `keepNewest` is for values that rotate (an OAuth access token): pruning on
 * each rotation while keeping the newest few leaves a turn that started on
 * the previous value working.
 */
export async function deleteSecrets(
  daytona: Daytona,
  { prefix, keep = [], keepNewest = 0 }: { prefix: string; keep?: string[]; keepNewest?: number }
): Promise<string[]> {
  const matching: { id: string; name: string; createdAt: number }[] = []
  let cursor: string | undefined
  do {
    // `name` is a partial-match filter, hence the prefix check.
    const page = await daytona.secret.list({ name: prefix, cursor, limit: 200 })
    for (const s of page.items) {
      if (s.name.startsWith(prefix)) matching.push({ id: s.id, name: s.name, createdAt: new Date(s.createdAt).getTime() })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  const newest = new Set(
    [...matching]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, keepNewest)
      .map((s) => s.name)
  )
  const doomed = matching.filter((s) => !keep.includes(s.name) && !newest.has(s.name))

  for (const { id, name } of doomed) {
    await daytona.secret.delete(id)
    ensuredSecrets.delete(name)
  }
  return doomed.map((s) => s.name)
}

async function findSecret(daytona: Daytona, name: string): Promise<{ id: string; placeholder: string } | undefined> {
  // `name` is a partial-match filter, hence the exact comparison.
  const { items } = await daytona.secret.list({ name })
  return items.find((s) => s.name === name)
}

async function createSecretIfMissing(daytona: Daytona, spec: EnsureSecretSpec, now: number): Promise<EnsuredSecret> {
  const value = spec.value()

  const existing = await findSecret(daytona, spec.name)
  if (existing) {
    try {
      await daytona.secret.update(existing.id, { description: stampLastUsed(spec.description, now) })
    } catch (err) {
      // Only the stamp is lost; a sweep may then delete the secret early, and
      // the next ensure after REVERIFY_MS recreates it.
      console.error(`[sandbox-secrets] failed to stamp Daytona secret ${spec.name} as used:`, err)
    }
    return { name: spec.name, placeholder: existing.placeholder }
  }

  try {
    const created = await daytona.secret.create({
      name: spec.name,
      value,
      description: stampLastUsed(spec.description, now),
      hosts: spec.hosts,
    })
    console.log(`[sandbox-secrets] created Daytona secret ${spec.name}`)
    return { name: spec.name, placeholder: created.placeholder }
  } catch (err) {
    if (!(err instanceof DaytonaConflictError)) throw err
    // Another process created it between our list and create.
    const raced = await findSecret(daytona, spec.name)
    if (!raced) throw err
    return { name: spec.name, placeholder: raced.placeholder }
  }
}
