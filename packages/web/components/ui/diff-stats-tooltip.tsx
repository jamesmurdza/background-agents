"use client"

import { cn } from "@/lib/shared/utils"

interface DiffStatsTooltipProps {
  additions: number
  deletions: number
  className?: string
}

/**
 * GitHub-style diff stats display with segmented bar.
 * Shows +additions / -deletions with a 5-segment proportional bar.
 */
export function DiffStatsTooltip({ additions, deletions, className }: DiffStatsTooltipProps) {
  const total = additions + deletions

  // Calculate segments (5 total, like GitHub)
  // Each segment represents 20% of changes
  let greenSegments = 0
  let redSegments = 0

  if (total > 0) {
    // Calculate proportions and round to nearest segment
    const greenRatio = additions / total
    greenSegments = Math.round(greenRatio * 5)
    redSegments = 5 - greenSegments

    // Ensure at least 1 segment for non-zero values
    if (additions > 0 && greenSegments === 0) greenSegments = 1
    if (deletions > 0 && redSegments === 0) redSegments = 1

    // Adjust if we went over 5
    if (greenSegments + redSegments > 5) {
      if (additions > deletions) redSegments = 5 - greenSegments
      else greenSegments = 5 - redSegments
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-green-600 font-medium">+{additions}</span>
      <span className="text-red-600 font-medium">−{deletions}</span>
      {total > 0 && (
        <span className="flex gap-px">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "w-1.5 h-2 rounded-[1px]",
                i < greenSegments ? "bg-green-500" : "bg-red-500"
              )}
            />
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * Tooltip class for diff stats - white background with shadow, no arrow
 */
export const diffStatsTooltipClass = "text-xs bg-white text-gray-900 shadow-lg border border-gray-200 [&>svg]:hidden"
