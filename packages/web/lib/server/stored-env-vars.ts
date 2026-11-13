/**
 * Reading a stored chat or repo env var (server-only).
 *
 * A stored var is its encrypted value. A short-lived build let users lock a
 * var as a Daytona secret, storing it as `{ v: <encrypted value>, hosts }`;
 * that feature is gone, and such a var now reads as a plain one.
 */

import { decrypt, encrypt } from "@/lib/db/encryption"

export function decryptStoredEnvVar(stored: unknown): string {
  const encrypted = stored && typeof stored === "object" ? (stored as { v?: unknown }).v : stored
  return typeof encrypted === "string" ? decrypt(encrypted) : ""
}

/** Decrypt a whole `{ key: storedValue }` map, e.g. a chat's or a repo's stored env vars. */
export function decryptStoredEnvVars(stored: Record<string, unknown>): Record<string, string> {
  const decrypted: Record<string, string> = {}
  for (const [key, value] of Object.entries(stored)) {
    if (value) decrypted[key] = decryptStoredEnvVar(value)
  }
  return decrypted
}

/** Trim keys, drop blank ones, and encrypt values for storage. */
export function encryptEnvVars(vars: Record<string, unknown>): Record<string, string> {
  const encrypted: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (typeof key === "string" && typeof value === "string" && key.trim()) {
      encrypted[key.trim()] = encrypt(value)
    }
  }
  return encrypted
}
