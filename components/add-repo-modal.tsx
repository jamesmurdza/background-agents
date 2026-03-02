"use client"

import { Github, X } from "lucide-react"
import { Input } from "@/components/ui/input"

interface AddRepoModalProps {
  open: boolean
  onClose: () => void
}

export function AddRepoModal({ open, onClose }: AddRepoModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Add Repository</h2>
          </div>
          <button
            onClick={onClose}
            className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">GitHub Repository URL</label>
            <Input
              type="url"
              placeholder="https://github.com/owner/repo"
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">Paste the full URL of the GitHub repository you want to add.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
