import { DaytonaConflictError, type Daytona } from "@daytonaio/sdk"

import { secretName, SECRET_PREFIX } from "./names"

/**
 * A description whose only content is the "last used" stamp set to `at`.
 * Its content doesn't matter (see {@link secretLastUsedAt}) beyond being
 * different on every call — a no-op `update()` doesn't bump the secret's
 * `updatedAt`, so writing a fresh, always-different value here is what
 * forces Daytona to actually refresh it.
 */
export function stampLastUsed(at: number): string {
  return `Last used: ${new Date(at).toISOString()}`
}

/**
 * When a secret was last used: Daytona's own `updatedAt`, which every
 * {@link stampLastUsed} write bumps by construction.
 */
export function secretLastUsedAt(secret: { updatedAt: Date | string }): number {
  return new Date(secret.updatedAt).getTime()
}

async function findSecret(daytona: Daytona, name: string): Promise<{ id: string; placeholder: string } | undefined> {
  // `name` is a partial-match filter, hence the exact comparison.
  const { items } = await daytona.secret.list({ name })
  return items.find((s) => s.name === name)
}

async function stampUsed(daytona: Daytona, id: string, name: string, now: number): Promise<void> {
  try {
    await daytona.secret.update(id, { description: stampLastUsed(now) })
  } catch (err) {
    // Only the stamp is lost; a sweep may then delete the secret early, and
    // the next ensure/touch recreates or re-stamps it.
    console.error(`[sandbox-secrets] failed to stamp Daytona secret ${name} as used:`, err)
  }
}

/**
 * Make sure the Daytona secret for `value()` restricted to `hosts` (named by
 * {@link secretName}) exists, creating it if not, and return its placeholder.
 *
 * `value()` is only called to compute the secret's name — and, if it turns
 * out missing, to create it; an existing secret's own API call is skipped,
 * so the thunk's laziness matters when the value is expensive or sensitive
 * to produce and the secret usually already exists. `hosts` restricts which
 * hosts the value may be sent to; omit to leave the secret unrestricted —
 * both are deliberate security properties of this function, not
 * implementation detail to simplify away.
 *
 * Stamps the secret's description as used, now, on every call — existing or
 * freshly created (see {@link secretLastUsedAt}) — so a sweep never deletes
 * one still in use. Throws if the secret can't be confirmed or created, e.g.
 * when the Daytona API key lacks permission to manage secrets.
 */
export async function ensureSecret(daytona: Daytona, value: () => string, hosts?: string[]): Promise<string> {
  const now = Date.now()
  const v = value()
  const name = secretName(v, hosts ?? [])

  const existing = await findSecret(daytona, name)
  if (existing) {
    await stampUsed(daytona, existing.id, name, now)
    return existing.placeholder
  }

  try {
    const created = await daytona.secret.create({ name, value: v, description: stampLastUsed(now), hosts })
    console.log(`[sandbox-secrets] created Daytona secret ${name}`)
    return created.placeholder
  } catch (err) {
    if (!(err instanceof DaytonaConflictError)) throw err
    // Another process created it between our list and create.
    const raced = await findSecret(daytona, name)
    if (!raced) throw err
    return raced.placeholder
  }
}

/**
 * Refresh the "last used" stamp of the existing Daytona secret named `name`,
 * without creating it if missing (there is no value to create it from).
 * Logs and returns rather than throwing when it's gone — the caller using it
 * finds out some other way (a failed mount).
 */
export async function touchSecret(daytona: Daytona, name: string): Promise<void> {
  const existing = await findSecret(daytona, name)
  if (!existing) {
    console.error(`[sandbox-secrets] can't stamp Daytona secret ${name} as used; it no longer exists`)
    return
  }
  await stampUsed(daytona, existing.id, name, Date.now())
}

/**
 * Every secret this app created (named with {@link SECRET_PREFIX}) whose
 * "last used" stamp is older than `olderThanMs`.
 */
async function listStaleSecrets(daytona: Daytona, olderThanMs: number): Promise<{ id: string; name: string }[]> {
  const now = Date.now()
  const doomed: { id: string; name: string }[] = []
  let cursor: string | undefined
  do {
    // `name` is a partial-match filter, hence the prefix check.
    const page = await daytona.secret.list({ name: SECRET_PREFIX, cursor, limit: 200 })
    for (const s of page.items) {
      if (!s.name.startsWith(SECRET_PREFIX)) continue
      if (now - secretLastUsedAt(s) >= olderThanMs) doomed.push({ id: s.id, name: s.name })
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return doomed
}

/**
 * Delete every secret this app created whose "last used" stamp is older
 * than `olderThanMs`, and return the names deleted. A sandbox with one of
 * them mounted stops getting it swapped within about half a minute, and
 * stays up. With `dryRun`, reports the names that would be deleted without
 * deleting anything.
 */
export async function deleteStaleSecrets(daytona: Daytona, olderThanMs: number, { dryRun = false } = {}): Promise<string[]> {
  const doomed = await listStaleSecrets(daytona, olderThanMs)
  if (dryRun) return doomed.map((s) => s.name)

  const deleted: string[] = []
  for (const { id, name } of doomed) {
    try {
      await daytona.secret.delete(id)
      deleted.push(name)
    } catch (err) {
      console.error(`[sandbox-secrets] failed to delete stale Daytona secret ${name}:`, err)
    }
  }
  return deleted
}
