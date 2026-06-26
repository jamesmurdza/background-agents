/**
 * Postgres rejects the NUL character (U+0000) in `text` and `jsonb` columns
 * with `invalid byte sequence for encoding "UTF8": 0x00`. Agent output
 * routinely contains stray NULs (binary file reads, terminal control bytes,
 * truncated UTF-8), so writing it verbatim makes the whole `prisma.*.update`
 * throw — and any sibling writes in the same statement are lost with it.
 *
 * These helpers strip NULs from strings (recursively, for JSON payloads) so the
 * write succeeds with the rest of the content intact.
 */

// The NUL code point. Built from a char code so the source stays free of
// literal control bytes.
const NUL = String.fromCharCode(0)

/** Remove NUL characters from a single string. */
export function stripNullBytes(value: string): string {
  return value.indexOf(NUL) === -1 ? value : value.split(NUL).join("")
}

/**
 * Recursively strip NUL characters from every string inside a JSON-ish value
 * (objects, arrays, strings). Non-string primitives pass through untouched.
 * Returns a cleaned copy; the input is not mutated.
 */
export function stripNullBytesDeep<T>(value: T): T {
  if (typeof value === "string") {
    return stripNullBytes(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripNullBytesDeep(v)) as unknown as T
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripNullBytesDeep(v)
    }
    return out as unknown as T
  }
  return value
}
