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
import { PR_DESCRIPTION_LABELS, type PRDescriptionType } from "@/lib/shared/schemas"

interface PRDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  remoteBranches: string[]
  selectedBaseBranch: string
  onSelectedBaseBranchChange: (branch: string) => void
  branchesLoading: boolean
  actionLoading: boolean
  onCreatePR: () => void
  onCancel: () => void
  descriptionType: PRDescriptionType
  onDescriptionTypeChange: (type: PRDescriptionType) => void
}

export function PRDialog({
  open,
  onOpenChange,
  branchName,
  remoteBranches,
  selectedBaseBranch,
  onSelectedBaseBranchChange,
  branchesLoading,
  actionLoading,
  onCreatePR,
  onCancel,
  descriptionType,
  onDescriptionTypeChange,
}: PRDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Create Pull Request</DialogTitle>
        </DialogHeader>
        {branchesLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : remoteBranches.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Source branch (current) */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">From branch</label>
              <div className="w-full rounded-md bg-muted/50 px-3 py-2 text-sm font-medium truncate">
                {branchName}
              </div>
            </div>

            {/* Target branch (select) */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Into branch</label>
              <Select value={selectedBaseBranch} onValueChange={onSelectedBaseBranchChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select base branch" />
                </SelectTrigger>
                <SelectContent>
                  {remoteBranches.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description type selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Description format</label>
              <Select value={descriptionType} onValueChange={(value) => onDescriptionTypeChange(value as PRDescriptionType)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select description format" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PR_DESCRIPTION_LABELS) as PRDescriptionType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      <div className="flex flex-col items-start">
                        <span>{PR_DESCRIPTION_LABELS[type].label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PR_DESCRIPTION_LABELS[descriptionType].description}
              </p>
            </div>
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
            onClick={onCreatePR}
            disabled={!selectedBaseBranch || actionLoading}
            className="cursor-pointer flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Create PR
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
