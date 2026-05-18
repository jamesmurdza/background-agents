"use client"

import { cn } from "@/lib/utils"

interface ClaudeUsageIndicatorProps {
  /** Number of messages used today */
  used: number | null
  /** Remaining messages (free users only) */
  remaining: number | null
  /** Daily limit (free users only) */
  total: number | null
  /** Whether user is pro */
  isPro: boolean
  /** Reset time ISO string */
  resetAt: string | null
  /** Display variant */
  variant?: "compact" | "full"
  /** Additional class names */
  className?: string
}

/**
 * Displays Claude usage information for users on the shared pool.
 * - Free users: "X/10" with color coding
 * - Pro users: "X sent today"
 * - Users with own API key: not shown (used is null)
 */
export function ClaudeUsageIndicator({
  used,
  remaining,
  total,
  isPro,
  resetAt,
  variant = "compact",
  className,
}: ClaudeUsageIndicatorProps) {
  // Don't show if user has their own API key (not using shared pool)
  if (used === null) return null

  // Calculate color for free users based on remaining
  const getColorClass = () => {
    if (isPro) return "text-muted-foreground"
    if (remaining === null || total === null) return "text-muted-foreground"
    const percentRemaining = remaining / total
    if (percentRemaining <= 0) return "text-destructive"
    if (percentRemaining <= 0.2) return "text-amber-500"
    return "text-muted-foreground"
  }

  // Format reset time for tooltip
  const formatResetTime = () => {
    if (!resetAt) return null
    try {
      const date = new Date(resetAt)
      return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    } catch {
      return null
    }
  }

  const resetTime = formatResetTime()
  const tooltip = resetTime ? `Resets at ${resetTime}` : undefined

  if (variant === "compact") {
    return (
      <span
        className={cn("text-xs", getColorClass(), className)}
        title={tooltip}
      >
        {isPro ? (
          <>{used} sent</>
        ) : (
          <>{used}/{total}</>
        )}
      </span>
    )
  }

  // Full variant - for menu items
  return (
    <div className={cn("flex items-center gap-2", className)} title={tooltip}>
      <span className={cn("text-sm", getColorClass())}>
        {isPro ? (
          <>{used} messages sent today</>
        ) : (
          <>{used} of {total} free messages used today</>
        )}
      </span>
    </div>
  )
}
