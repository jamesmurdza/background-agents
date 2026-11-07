/**
 * Bonus credits: one-off grants an admin hands out for community contributions
 * (starring the repo, opening a PR, filing an issue) from the /admin Credits
 * panel. Stars can also be rewarded immediately through the user claim route.
 *
 * Shared by the admin UI and the API route, so it stays free of server-only
 * imports. Ledger rows are written as `type: "grant"` with
 * `metadata.source === BONUS_CREDIT_SOURCE`, which is how the panel's history
 * tells them apart from signup grants and single-user manual grants.
 */

export const BONUS_CREDIT_SOURCE = "admin_bonus"

/** The repo users are asked to star, linked from the welcome screen. */
export const GITHUB_REPO_URL = "https://github.com/jamesmurdza/background-agents"
export const GITHUB_STAR_CREDIT_USD = 1.0

export const BONUS_CREDIT_REASONS = [
  { key: "github_star", label: "Starred the repo" },
  { key: "pull_request", label: "Opened a pull request" },
  { key: "issue", label: "Opened an issue" },
  { key: "other", label: "Other" },
] as const

export type BonusCreditReason = (typeof BONUS_CREDIT_REASONS)[number]["key"]

export function bonusReasonLabel(reason: string): string {
  return BONUS_CREDIT_REASONS.find((r) => r.key === reason)?.label ?? reason
}

/**
 * Guard against a mistyped amount, not a policy limit. Lower than the
 * single-user ceiling because it is multiplied by the recipient count.
 */
export const MAX_BONUS_CREDIT_USD = 1_000
/** Cap on an explicit recipient list; "all users" is its own mode. */
const MAX_BONUS_RECIPIENTS = 1_000
const MAX_BONUS_NOTE_LENGTH = 500
const MAX_BONUS_REFERENCE_LENGTH = 300

export interface BonusCreditRequest {
  target: "users" | "all"
  /** Required (non-empty) when target is "users"; ignored for "all". */
  userIds: string[]
  amountUsd: number
  reason: BonusCreditReason
  /** Free text shown to admins in the history. Required for "other". */
  note: string | null
  /**
   * Optional dedupe key — a PR/issue URL or number. Granting the same reason
   * and reference to the same user twice is skipped rather than doubled.
   */
  reference: string | null
}

export type ParseResult =
  | { ok: true; value: BonusCreditRequest }
  | { ok: false; error: string }

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** Validate an untrusted request body. */
export function parseBonusCreditRequest(body: unknown): ParseResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" }
  const b = body as Record<string, unknown>

  const target = b.target
  if (target !== "users" && target !== "all") {
    return { ok: false, error: 'target must be "users" or "all"' }
  }

  let userIds: string[] = []
  if (target === "users") {
    if (!Array.isArray(b.userIds) || b.userIds.some((id) => typeof id !== "string" || !id)) {
      return { ok: false, error: "userIds must be an array of user ids" }
    }
    userIds = [...new Set(b.userIds as string[])]
    if (userIds.length === 0) return { ok: false, error: "Select at least one user" }
    if (userIds.length > MAX_BONUS_RECIPIENTS) {
      return { ok: false, error: `At most ${MAX_BONUS_RECIPIENTS} users per grant` }
    }
  }

  const amountUsd = b.amountUsd
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    return { ok: false, error: "amountUsd must be a positive number" }
  }
  if (amountUsd > MAX_BONUS_CREDIT_USD) {
    return { ok: false, error: `amountUsd must be at most ${MAX_BONUS_CREDIT_USD}` }
  }

  const reason = b.reason
  if (!BONUS_CREDIT_REASONS.some((r) => r.key === reason)) {
    return { ok: false, error: "Unknown reason" }
  }

  const note = trimmedOrNull(b.note, MAX_BONUS_NOTE_LENGTH)
  if (reason === "other" && !note) {
    return { ok: false, error: 'A note is required when the reason is "Other"' }
  }

  return {
    ok: true,
    value: {
      target,
      userIds,
      amountUsd,
      reason: reason as BonusCreditReason,
      note,
      reference: trimmedOrNull(b.reference, MAX_BONUS_REFERENCE_LENGTH),
    },
  }
}

/**
 * Ledger idempotency key for one recipient, or null when the grant is allowed
 * to repeat.
 *
 * A star can only be given once per account, so it always dedupes. A PR or
 * issue dedupes only when the admin names which one — otherwise two grants
 * for two different PRs would collide.
 */
export function bonusExternalId(
  userId: string,
  reason: BonusCreditReason,
  reference: string | null
): string | null {
  if (reason === "github_star") return `bonus:github_star:${userId}`
  if (reference) return `bonus:${reason}:${reference.toLowerCase()}:${userId}`
  return null
}
