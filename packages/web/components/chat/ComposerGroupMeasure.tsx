"use client"

import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"

export interface ComposerGroupItem {
  icon: ReactNode
  /** Omit entirely (not just empty string) to render this item icon-only. */
  label?: string
  chevron?: boolean
}

/**
 * Hidden, off-screen twin of one composer trigger group (left or right),
 * rendered at its full natural footprint — real icons and real label text,
 * but no interactivity or data fetching — purely so useTwoTierCollapse can
 * measure how much room the group would need without touching what's
 * actually on screen (see that hook for why).
 */
export function ComposerGroupMeasure({ groupRef, items }: { groupRef: React.Ref<HTMLDivElement>; items: ComposerGroupItem[] }) {
  return (
    <div
      ref={groupRef}
      aria-hidden="true"
      className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-2"
    >
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1 whitespace-nowrap">
          {item.icon}
          {item.label !== undefined && <span>{item.label}</span>}
          {item.chevron && <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        </span>
      ))}
    </div>
  )
}
