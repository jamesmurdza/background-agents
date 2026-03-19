"use client"

import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tagNameInput: string
  onTagNameInputChange: (value: string) => void
  actionLoading: boolean
  onTag: () => void
  onCancel: () => void
}

export function TagDialog({
  open,
  onOpenChange,
  tagNameInput,
  onTagNameInputChange,
  actionLoading,
  onTag,
  onCancel,
}: TagDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Create Tag</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="v1.0.0"
          value={tagNameInput}
          onChange={(e) => onTagNameInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onTag() }}
          className="h-8 text-xs font-mono"
          autoFocus
        />
        <DialogFooter>
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onTag}
            disabled={!tagNameInput.trim() || actionLoading}
            className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Create
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
