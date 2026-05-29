"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Search, GitBranch, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { GitHubBranch } from "@/lib/types"

interface BranchPickerStepProps {
  isMobile: boolean
  /**
   * When true, the cancel button reads "Cancel" and `onBack` closes the modal
   * rather than returning to the repo-selection step. Used when the modal was
   * opened via the palette with a preselected repo.
   */
  isBranchOnly: boolean
  /** All branches for the currently-selected repo. */
  branches: GitHubBranch[]
  /** Used to surface the repo's default branch at the top of the list. */
  defaultBranchName: string | undefined
  /** Initial selection — typically the repo's default branch. */
  initialBranch: string
  /**
   * Open the dropdown immediately on mount. Used in branch-only mode where
   * the picker is the only thing the user came here to do, so we skip the
   * "click to expand" step.
   */
  autoOpenDropdown?: boolean
  /**
   * Fired whenever the branch dropdown opens/closes. The parent uses it to
   * widen the container's overflow so the dropdown doesn't get clipped.
   */
  onDropdownOpenChange?: (open: boolean) => void
  onConfirm: (branch: string) => void
  /** Back (or Cancel in branch-only mode). */
  onBack: () => void
}

/**
 * Branch selection step inside the RepoPickerModal.
 *
 * Self-contained: owns the selected branch, the dropdown open/closed state,
 * the branch-name search filter, and keyboard navigation. The parent supplies
 * the branches list (fetched per repo) and handles confirm/back routing.
 *
 * Default-branch sort: the repo's default branch is always pinned to the top
 * regardless of the current search filter.
 */
export function BranchPickerStep({
  isMobile,
  isBranchOnly,
  branches,
  defaultBranchName,
  initialBranch,
  autoOpenDropdown = false,
  onDropdownOpenChange,
  onConfirm,
  onBack,
}: BranchPickerStepProps) {
  const [selectedBranch, setSelectedBranch] = useState(initialBranch)
  const [showBranchDropdown, setShowBranchDropdownState] = useState(autoOpenDropdown)
  const [branchSearch, setBranchSearch] = useState("")
  const [selectedBranchIndex, setSelectedBranchIndex] = useState(0)
  const branchSearchInputRef = useRef<HTMLInputElement>(null)

  // Wrapper so consumers see open/close transitions — they widen the parent's
  // overflow so the dropdown isn't clipped.
  const setShowBranchDropdown = (open: boolean) => {
    setShowBranchDropdownState(open)
    onDropdownOpenChange?.(open)
  }

  // Focus the branch search input when the dropdown opens. Small delay so the
  // dropdown is mounted before we focus.
  useEffect(() => {
    if (showBranchDropdown && branchSearchInputRef.current) {
      setTimeout(() => {
        branchSearchInputRef.current?.focus()
      }, 50)
    }
  }, [showBranchDropdown])

  // Fire the open callback for the initial autoOpen case (the setter wrapper
  // only fires for subsequent transitions).
  useEffect(() => {
    if (autoOpenDropdown) {
      onDropdownOpenChange?.(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reset keyboard cursor whenever the search filter changes — otherwise the
  // index could land outside the new filtered list.
  useEffect(() => {
    setSelectedBranchIndex(0)
  }, [branchSearch])

  const filteredBranches = useMemo(
    () =>
      branches
        .filter((branch) =>
          branch.name.toLowerCase().includes(branchSearch.toLowerCase())
        )
        .sort((a, b) => {
          // Default branch always comes first
          if (a.name === defaultBranchName) return -1
          if (b.name === defaultBranchName) return 1
          return 0
        }),
    [branches, branchSearch, defaultBranchName]
  )

  const handleSelectBranchFromDropdown = (branch: GitHubBranch) => {
    setSelectedBranch(branch.name)
    setShowBranchDropdown(false)
    setBranchSearch("")
  }

  const handleBranchKeyDown = (e: React.KeyboardEvent) => {
    if (filteredBranches.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedBranchIndex((prev) =>
          Math.min(prev + 1, filteredBranches.length - 1)
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedBranchIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter": {
        e.preventDefault()
        const next = filteredBranches[selectedBranchIndex]
        if (next) handleSelectBranchFromDropdown(next)
        break
      }
      case "Escape":
        e.preventDefault()
        setShowBranchDropdown(false)
        setBranchSearch("")
        break
    }
  }

  return (
    <div className={cn(isMobile ? "p-4" : "p-4")}>
      <div className={cn(isMobile ? "mb-6" : "mb-4")}>
        <label
          className={cn(
            "block font-medium mb-2",
            isMobile ? "text-base" : "text-sm"
          )}
        >
          Base Branch
        </label>
        <div className="relative">
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            className={cn(
              "flex items-center justify-between w-full border border-border rounded-md hover:bg-accent/50 active:bg-accent transition-colors",
              isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
            )}
          >
            <span className="flex items-center gap-2">
              <GitBranch
                className={cn(
                  "text-muted-foreground",
                  isMobile ? "h-5 w-5" : "h-4 w-4"
                )}
              />
              {selectedBranch}
            </span>
            <ChevronDown
              className={cn(
                "text-muted-foreground",
                isMobile ? "h-5 w-5" : "h-4 w-4"
              )}
            />
          </button>

          {showBranchDropdown && (
            <div
              className={cn(
                "absolute left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-[200] overflow-hidden flex flex-col",
                isMobile ? "max-h-72" : "max-h-60"
              )}
            >
              {/* Branch search input */}
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={branchSearchInputRef}
                    type="text"
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    onKeyDown={handleBranchKeyDown}
                    placeholder="Search branches..."
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="overflow-y-auto flex-1">
                {filteredBranches.length === 0 ? (
                  <div
                    className={cn(
                      "text-muted-foreground text-center",
                      isMobile ? "p-4 text-base" : "p-2 text-sm"
                    )}
                  >
                    No branches found
                  </div>
                ) : (
                  filteredBranches.map((branch, index) => (
                    <button
                      key={branch.name}
                      onClick={() => handleSelectBranchFromDropdown(branch)}
                      className={cn(
                        "flex items-center gap-2 w-full text-left hover:bg-accent active:bg-accent transition-colors touch-target",
                        isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm",
                        (index === selectedBranchIndex ||
                          branch.name === selectedBranch) &&
                          "bg-accent"
                      )}
                    >
                      <GitBranch
                        className={cn(
                          "text-muted-foreground",
                          isMobile ? "h-4 w-4" : "h-3 w-3"
                        )}
                      />
                      {branch.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onBack}
          className={cn(
            "rounded-md hover:bg-accent active:bg-accent transition-colors touch-target",
            isMobile ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
          )}
        >
          {isBranchOnly ? "Cancel" : "Back"}
        </button>
        <button
          onClick={() => onConfirm(selectedBranch)}
          disabled={!selectedBranch}
          className={cn(
            "bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 touch-target",
            isMobile ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
          )}
        >
          OK
        </button>
      </div>
    </div>
  )
}
