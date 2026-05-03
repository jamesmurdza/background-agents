"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { Search, GitBranch, Loader2 } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { fetchRepo, fetchBranches } from "@/lib/github"
import type { GitHubBranch } from "@/lib/types"

interface BranchPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (branch: string) => void
  repo: string
  owner: string
  /** The currently selected base branch for this chat */
  selectedBranch?: string
  isMobile?: boolean
}

export function BranchPickerModal({
  open,
  onClose,
  onSelect,
  repo,
  owner,
  selectedBranch,
  isMobile = false,
}: BranchPickerModalProps) {
  const { data: session } = useSession()
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [repoDefaultBranch, setRepoDefaultBranch] = useState<string>("main")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const searchInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  // Reset state and fetch repo info + branches when modal opens or repo changes
  useEffect(() => {
    if (open && session?.accessToken && repo && owner) {
      // Reset all state when opening with a new repo
      setSearch("")
      setError(null)
      setBranches([])
      setSelectedIndex(0)
      setLoading(true)

      // Fetch repo info (for default branch) and branches in parallel
      Promise.all([
        fetchRepo(session.accessToken, owner, repo),
        fetchBranches(session.accessToken, owner, repo)
      ])
        .then(([repoInfo, fetchedBranches]) => {
          setRepoDefaultBranch(repoInfo.default_branch)
          setBranches(fetchedBranches)
          // Set selectedIndex to the currently selected branch, or default branch
          const targetBranch = selectedBranch || repoInfo.default_branch
          const targetIndex = fetchedBranches.findIndex(b => b.name === targetBranch)
          setSelectedIndex(targetIndex >= 0 ? targetIndex : 0)
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch branches"))
        .finally(() => setLoading(false))
    }
  }, [open, session?.accessToken, repo, owner, selectedBranch])

  // Focus search field when modal opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [open])

  const filteredBranches = branches
    .filter((branch) => branch.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // Default branch always comes first
      if (a.name === repoDefaultBranch) return -1
      if (b.name === repoDefaultBranch) return 1
      return 0
    })

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
        const selectedBranchItem = filteredBranches[selectedIndex]
        if (selectedBranchItem) {
          handleSelectBranch(selectedBranchItem.name)
        }
        break
      case "Escape":
        e.preventDefault()
        onClose()
        break
    }
  }, [filteredBranches, selectedIndex, onClose])

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
        >
          {/* Draggable header area */}
          <div {...dragHandlers}>
            {/* Drag handle for mobile */}
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
            )}

            <ModalHeader title="Select Branch" />
          </div>

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
                        {branch.name === repoDefaultBranch && (
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
