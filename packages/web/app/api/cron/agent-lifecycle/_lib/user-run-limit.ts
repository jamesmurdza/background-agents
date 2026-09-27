import type { Settings } from "@/lib/types"

/** Bounds mirrored from app/api/user/settings/route.ts, enforced again here in
 * case a row was ever written by another path. */
const MIN_MINUTES = 1
const MAX_MINUTES = 24 * 60 // one day

/**
 * The hard timeout to apply to one user's run: their own `maxAgentRunMinutes`
 * override if they're an admin and set one, otherwise `fallback` (the
 * INTERACTIVE_HARD_TIMEOUT/SCHEDULED_HARD_TIMEOUT constant).
 *
 * `maxAgentRunMinutes` is a Developer-settings field gated admin-only on write
 * (see app/api/user/settings/route.ts) so only admins can extend their own
 * runs past the default — regular users always get `fallback`. Re-validated
 * here rather than trusted as stored, so a row written before validation
 * existed (or edited directly) can't force a run to skip the cron entirely.
 */
export function resolveUserRunLimit(
  user: { isAdmin: boolean; settings: unknown },
  fallback: number
): number {
  if (!user.isAdmin) return fallback

  const override = (user.settings as Partial<Settings> | null)?.maxAgentRunMinutes
  if (
    typeof override !== "number" ||
    !Number.isFinite(override) ||
    !Number.isInteger(override) ||
    override < MIN_MINUTES ||
    override > MAX_MINUTES
  ) {
    return fallback
  }
  return override
}
