"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { Search, GitBranch, Loader2 } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { fetchBranches } from "@/lib/github"
import type { GitHubBranch } from "@/lib/types"

interface BranchPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (branch: string) => void
  repo: string
  owner: string
  defaultBranch?: string
  isMobile?: boolean
}

const SWIPE_THRESHOLD = 100 // Minimum swipe distance to dismiss

export function BranchPickerModal({
  open,
  onClose,
  onSelect,
  repo,
  owner,
  defaultBranch = "main",
  isMobile = false,
}: BranchPickerModalProps) {
  const { data: session } = useSession()
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const searchInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Swipe gesture state
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startTime, setStartTime] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  useEffect(() => {
    if (open && session?.accessToken && repo && owner) {
      setLoading(true)
      setError(null)

      fetchBranches(session.accessToken, owner, repo)
        .then(setBranches)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch branches"))
        .finally(() => setLoading(false))
    }
  }, [open, session?.accessToken, repo, owner])

  useEffect(() => {
    if (open) {
      setSearch("")
      setError(null)
      setDragY(0)
    }
  }, [open])

  // Focus search field when modal opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [open])

  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(search.toLowerCase())
  )

  // Handle branch selection - one-click: select branch immediately
  const handleSelectBranch = (branchName: string) => {
    onSelect(branchName)
    onClose()
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filteredBranches.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filteredBranches.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        const selectedBranch = filteredBranches[selectedIndex]
        if (selectedBranch) {
          handleSelectBranch(selectedBranch.name)
        }
        break
      case "Escape":
        e.preventDefault()
        onClose()
        break
    }
  }, [filteredBranches, selectedIndex, onClose])

  // Swipe gesture handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return

    // Only enable swipe when at top of scroll
    const content = contentRef.current
    if (content && content.scrollTop > 0) return

    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setStartTime(Date.now())
    setDragY(0)
  }, [isMobile])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !isMobile) return

    const currentY = e.touches[0].clientY
    const diff = currentY - startY

    // Only allow dragging down
    if (diff > 0) {
      setDragY(diff)
    }
  }, [isDragging, startY, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !isMobile) return

    setIsDragging(false)

    const duration = Date.now() - startTime
    const velocity = Math.abs(dragY) / duration

    // Close if dragged far enough or fast enough
    if (dragY > SWIPE_THRESHOLD || velocity > 0.5) {
      onClose()
    }

    setDragY(0)
  }, [isDragging, dragY, startTime, onClose, isMobile])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            setTimeout(() => {
              searchInputRef.current?.focus()
            }, 0)
          }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col overflow-hidden",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-lg shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? {
            transform: `translateY(${dragY}px)`,
          } : undefined}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Drag handle for mobile */}
          {isMobile && (
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
          )}

          <ModalHeader title="Select Branch" />

          {/* Repo info breadcrumb */}
          <div className={cn(
            "border-b border-border bg-muted/30",
            isMobile ? "px-4 py-3" : "px-4 py-2"
          )}>
            <div className={cn(
              "font-medium flex items-center gap-2",
              isMobile ? "text-base" : "text-sm"
            )}>
              <GitBranch className={cn(
                "text-muted-foreground",
                isMobile ? "h-5 w-5" : "h-4 w-4"
              )} />
              {owner}/{repo}
            </div>
          </div>

          {/* Search */}
          <div className={cn(
            "border-b border-border",
            isMobile ? "p-4" : "p-4"
          )}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search branches..."
                className="pl-8"
              />
            </div>
          </div>

          {/* Content */}
          <div
            ref={contentRef}
            className={cn(
              "flex-1 mobile-scroll overflow-y-auto",
              isMobile ? "max-h-none" : "max-h-80"
            )}
          >
            {error && (
              <div className={cn(
                "text-destructive text-center",
                isMobile ? "p-6 text-base" : "p-4 text-sm"
              )}>
                {error}
              </div>
            )}

            {loading && (
              <div className={cn(
                "flex items-center justify-center",
                isMobile ? "p-12" : "p-8"
              )}>
                <Loader2 className={cn(
                  "animate-spin text-muted-foreground",
                  isMobile ? "h-8 w-8" : "h-6 w-6"
                )} />
              </div>
            )}

            {!loading && !error && (
              <div className={cn(isMobile ? "p-3" : "p-2")}>
                {filteredBranches.length === 0 ? (
                  <div className={cn(
                    "text-muted-foreground text-center",
                    isMobile ? "p-6 text-base" : "p-4 text-sm"
                  )}>
                    {search ? "No branches match your search" : "No branches found"}
                  </div>
                ) : (
                  filteredBranches.map((branch, index) => (
                    <button
                      key={branch.name}
                      onClick={() => handleSelectBranch(branch.name)}
                      className={cn(
                        "flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors text-left touch-target",
                        isMobile ? "px-4 py-4" : "px-3 py-2",
                        index === selectedIndex && "bg-accent"
                      )}
                    >
                      <GitBranch className={cn(
                        "text-muted-foreground shrink-0",
                        isMobile ? "h-5 w-5" : "h-4 w-4"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "font-medium truncate",
                          isMobile ? "text-base" : "text-sm"
                        )}>
                          {branch.name}
                        </div>
                        {branch.name === defaultBranch && (
                          <div className={cn(
                            "text-muted-foreground",
                            isMobile ? "text-sm" : "text-xs"
                          )}>
                            default
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
