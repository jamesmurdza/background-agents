import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Card shell for an admin dashboard chart: icon badge + title header, and a
 * pulsing placeholder in place of the body while `isLoading`.
 *
 * `iconClassName` carries both the badge tint and icon colour, e.g.
 * "bg-teal-500/10 text-teal-500".
 */
export function ChartCard({
  icon: Icon,
  iconClassName,
  title,
  isLoading = false,
  skeletonHeight = 250,
  className,
  children,
}: {
  icon: LucideIcon
  iconClassName: string
  title: ReactNode
  isLoading?: boolean
  skeletonHeight?: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 md:p-6 shadow-sm", className)}>
      <div className="mb-4 flex items-center gap-2">
        <div
          className={cn("flex h-8 w-8 items-center justify-center rounded-lg", iconClassName)}
        >
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-medium">{title}</h3>
      </div>
      {isLoading ? (
        <div className="animate-pulse rounded bg-muted/50" style={{ height: skeletonHeight }} />
      ) : (
        children
      )}
    </div>
  )
}
