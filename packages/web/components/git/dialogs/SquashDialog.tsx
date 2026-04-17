"use client"

import { Loader2, Minus, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface SquashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchName: string
  squashCount: number
  onSquashCountChange: (count: number) => void
  actionLoading: boolean
  onSquash: () => void
  onCancel: () => void
}

export function SquashDialog({
  open,
  onOpenChange,
  branchName,
  squashCount,
  onSquashCountChange,
  actionLoading,
  onSquash,
  onCancel,
}: SquashDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Squash commits on {branchName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Number of commits to squash
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSquashCountChange(Math.max(2, squashCount - 1))}
                disabled={squashCount <= 2}
                className="rounded-md border border-border bg-input hover:bg-accent disabled:opacity-50 transition-colors p-2"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="flex-1 text-center bg-input border border-border rounded-md py-2 text-base font-medium">
                {squashCount}
              </div>
              <button
                type="button"
                onClick={() => onSquashCountChange(squashCount + 1)}
                className="rounded-md border border-border bg-input hover:bg-accent transition-colors p-2"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Squash the last {squashCount} commits into a single commit
            </p>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onSquash}
            disabled={squashCount < 2 || actionLoading}
            className="cursor-pointer flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Squash
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
