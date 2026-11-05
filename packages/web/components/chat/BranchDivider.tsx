import { GitBranch } from "lucide-react"

/**
 * Marks where the inherited parent history (shown for context, rendered muted)
 * ends and this branch's own conversation begins. Minimal centered divider.
 */
export function BranchDivider() {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span>History above is inherited from the parent chat</span>
    </div>
  )
}
