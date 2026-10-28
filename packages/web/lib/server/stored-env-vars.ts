/**
 * Reading a stored chat or repo env var (server-only).
 *
 * A stored var is its encrypted value. A short-lived build let users lock a
 * var as a Daytona secret, storing it as `{ v: <encrypted value>, hosts }`;
 * that feature is gone, and such a var now reads as a plain one.
 */

import { decrypt } from "@/lib/db/encryption"

export function decryptStoredEnvVar(stored: unknown): string {
  const encrypted = stored && typeof stored === "object" ? (stored as { v?: unknown }).v : stored
  return typeof encrypted === "string" ? decrypt(encrypted) : ""
}
