"use client"

import { Loader2 } from "lucide-react"
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

interface RebaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  remoteBranches: string[]
  selectedBranch: string
  onSelectedBranchChange: (branch: string) => void
  branchesLoading: boolean
  actionLoading: boolean
  onRebase: () => void
  onCancel: () => void
}

export function RebaseDialog({
  open,
  onOpenChange,
  branchName,
  remoteBranches,
  selectedBranch,
  onSelectedBranchChange,
  branchesLoading,
  actionLoading,
  onRebase,
  onCancel,
}: RebaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Rebase {branchName} onto...</DialogTitle>
        </DialogHeader>
        {branchesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : remoteBranches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
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
        <DialogFooter>
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onRebase}
            disabled={!selectedBranch || actionLoading}
            className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Rebase
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
