"use client"

import { Loader2, ArrowUpDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  remoteBranches: string[]
  selectedBranch: string
  onSelectedBranchChange: (branch: string) => void
  mergeDirection: "into-current" | "from-current"
  onToggleMergeDirection: () => void
  branchesLoading: boolean
  actionLoading: boolean
  onMerge: () => void
  onCancel: () => void
}

export function MergeDialog({
  open,
  onOpenChange,
  branchName,
  remoteBranches,
  selectedBranch,
  onSelectedBranchChange,
  mergeDirection,
  onToggleMergeDirection,
  branchesLoading,
  actionLoading,
  onMerge,
  onCancel,
}: MergeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Merge branches</DialogTitle>
        </DialogHeader>
        {branchesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : remoteBranches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
        ) : (
          <div className="flex flex-col items-center gap-1">
            {/* Source (top) */}
            {mergeDirection === "from-current" ? (
              <div className="w-full rounded-md bg-muted/50 px-3 py-2 text-sm font-medium text-left truncate">
                {branchName}
              </div>
            ) : (
              <Select value={selectedBranch} onValueChange={onSelectedBranchChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {remoteBranches.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Arrow with "into" and swap button */}
            <div className="flex items-center justify-between w-full py-1">
              <div className="flex-1" />
              <span className="text-xs text-muted-foreground">into</span>
              <div className="flex-1 flex justify-end">
                <button
                  type="button"
                  onClick={onToggleMergeDirection}
                  className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  title="Swap merge direction"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Target (bottom) */}
            {mergeDirection === "from-current" ? (
              <Select value={selectedBranch} onValueChange={onSelectedBranchChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {remoteBranches.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="w-full rounded-md bg-muted/50 px-3 py-2 text-sm font-medium text-left truncate">
                {branchName}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onMerge}
            disabled={!selectedBranch || actionLoading}
            className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Merge
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
