"use client"

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Sortable `<th>` for an admin table: a label plus an icon showing whether
 * this column is the active sort key, and if so which direction.
 *
 * Generic over the table's own `SortField` union so each table keeps its own
 * field vocabulary (and typo-checking) without sharing one — only the header
 * chrome is shared.
 */
export function SortHeader<TField extends string>({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  align = "left",
  className,
}: {
  label: string
  field: TField
  currentField: TField
  currentOrder: "asc" | "desc"
  onSort: (field: TField) => void
  align?: "left" | "center" | "right"
  className?: string
}) {
  const isActive = currentField === field
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      <button
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse"
        )}
      >
        {label}
        {isActive ? (
          currentOrder === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </button>
    </th>
  )
}
