"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { Search, GitBranch, Loader2, Lock, Globe, ChevronDown, ChevronLeft, Plus } from "lucide-react"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { fetchRepos, fetchBranches, createRepository } from "@/lib/github"
import type { GitHubRepo, GitHubBranch } from "@/lib/types"

interface RepoPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (repo: string, branch: string) => void
  isMobile?: boolean
  /** Which flow to show. Callers are expected to pick exactly one. */
  mode: "select" | "create" | "branch-only"
  /** Suggested name for the new repo (typically the chat's display name). */
  suggestedName?: string | null
  /** Shown as a + button in select mode — closes this modal and signals the
   *  caller to open the separate Create Repository modal. Not rendered in
   *  create mode so the two flows stay independent. */
  onRequestCreate?: () => void
  /** Pre-selected repo - when provided, modal opens directly to branch selection.
   *  Used when user selects a repo from the command menu. */
  preselectedRepo?: GitHubRepo | null
}

// Slugify a chat title into a GitHub-friendly repo name: lowercase, hyphenated,
// alphanumerics only, trimmed to GitHub's 100-char limit.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

type Step = "repo" | "branch" | "create"
type Tab = "select" | "create"

const SWIPE_THRESHOLD = 100 // Minimum swipe distance to dismiss

export function RepoPickerModal({ open, onClose, onSelect, isMobile = false, mode, suggestedName = null, onRequestCreate, preselectedRepo = null }: RepoPickerModalProps) {
  const allowSelect = mode === "select"
  const allowCreate = mode === "create"
  const isBranchOnly = mode === "branch-only"
  const { data: session } = useSession()

  // Determine initial tab based on what's allowed
  const initialTab: Tab = allowSelect ? "select" : "create"
  const [step, setStep] = useState<Step>("repo")
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string>("")
  const [showBranchDropdown, setShowBranchDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [branchSearch, setBranchSearch] = useState("")

  // Create repo form state
  const [newRepoName, setNewRepoName] = useState("")
  const [newRepoDescription, setNewRepoDescription] = useState("")
  const [newRepoIsPrivate, setNewRepoIsPrivate] = useState(true)
  const [creating, setCreating] = useState(false)

  // Swipe gesture state
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const branchSearchInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Selection index for keyboard navigation
  const [selectedRepoIndex, setSelectedRepoIndex] = useState(0)
  const [selectedBranchIndex, setSelectedBranchIndex] = useState(0)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Focus search field when modal opens on select tab
  useEffect(() => {
    if (open && step === "repo" && activeTab === "select" && searchInputRef.current) {
      // Small delay to ensure the modal is rendered
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [open, step, activeTab])

  // Focus branch search when dropdown opens
  useEffect(() => {
    if (showBranchDropdown && branchSearchInputRef.current) {
      setTimeout(() => {
        branchSearchInputRef.current?.focus()
      }, 50)
    }
  }, [showBranchDropdown])

  // Reset selection index when filtered results change
  useEffect(() => {
    setSelectedRepoIndex(0)
  }, [search])

  useEffect(() => {
    setSelectedBranchIndex(0)
  }, [branchSearch])

  // Fetch repos on open — only when the select tab is available; otherwise we
  // never show the repo list and the loading spinner would flash for nothing.
  useEffect(() => {
    if (open && session?.accessToken && allowSelect) {
      setLoading(true)
      setError(null)
      fetchRepos(session.accessToken)
        .then(setRepos)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [open, session?.accessToken, allowSelect])

  // Reset state on close/open - set correct initial tab
  // Also reset when modal opens to ensure correct tab based on current allowSelect/allowCreate values
  useEffect(() => {
    if (open) {
      // When opening, set the correct initial tab based on what's allowed
      // Default to "select" if allowed, otherwise "create"
      setActiveTab(allowSelect ? "select" : "create")
      // Prefill the create form name with a slugified version of the chat title.
      if (suggestedName) {
        setNewRepoName((prev) => prev || slugify(suggestedName))
      }
    } else {
      // When closing, reset all state
      setStep("repo")
      setActiveTab(allowSelect ? "select" : "create")
      setSelectedRepo(null)
      setSelectedBranch("")
      setBranches([])
      setSearch("")
      setBranchSearch("")
      setShowBranchDropdown(false)
      setError(null)
      setDragY(0)
      // Reset create form
      setNewRepoName("")
      setNewRepoDescription("")
      setNewRepoIsPrivate(true)
      setCreating(false)
    }
  }, [open, allowSelect, suggestedName])

  // Handle branch-only mode with preselected repo - skip to branch selection
  useEffect(() => {
    if (open && isBranchOnly && preselectedRepo && session?.accessToken) {
      setSelectedRepo(preselectedRepo)
      setSelectedBranch(preselectedRepo.default_branch)
      setStep("branch")
      setLoading(true)
      setError(null)
      setShowBranchDropdown(true)

      fetchBranches(session.accessToken, preselectedRepo.owner.login, preselectedRepo.name)
        .then(setBranches)
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to fetch branches"))
        .finally(() => setLoading(false))
    }
  }, [open, isBranchOnly, preselectedRepo, session?.accessToken])

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

  // Handle repo selection - one-click: select repo with default branch immediately
  // User can change branch later via the branch button in the chat header
  const handleSelectRepo = (repo: GitHubRepo) => {
    onSelect(repo.full_name, repo.default_branch)
    onClose()
  }

  // Handle branch selection from dropdown
  const handleSelectBranchFromDropdown = (branch: GitHubBranch) => {
    setSelectedBranch(branch.name)
    setShowBranchDropdown(false)
    setBranchSearch("")
  }

  // Handle OK button click
  const handleConfirm = () => {
    if (!selectedRepo || !selectedBranch) return
    onSelect(selectedRepo.full_name, selectedBranch)
    onClose()
  }

  // Handle create repository
  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      setError("Repository name is required")
      return
    }

    // Validate repo name format
    const nameRegex = /^[a-zA-Z0-9._-]+$/
    if (!nameRegex.test(newRepoName.trim())) {
      setError("Repository name can only contain alphanumeric characters, hyphens, underscores, and periods")
      return
    }

    setCreating(true)
    setError(null)

    try {
      const repo = await createRepository({
        name: newRepoName.trim(),
        description: newRepoDescription.trim() || undefined,
        isPrivate: newRepoIsPrivate,
      })

      // Select the newly created repo and complete
      onSelect(repo.full_name, repo.default_branch)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repository")
    } finally {
      setCreating(false)
    }
  }

  // Filter items by search
  const filteredRepos = repos.filter((repo) =>
    repo.full_name.toLowerCase().includes(search.toLowerCase())
  )
  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(branchSearch.toLowerCase())
  )

  // Handle keyboard navigation for repo list
  const handleRepoKeyDown = (e: React.KeyboardEvent) => {
    if (filteredRepos.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedRepoIndex((prev) => Math.min(prev + 1, filteredRepos.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedRepoIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        const selectedRepo = filteredRepos[selectedRepoIndex]
        if (selectedRepo) {
          handleSelectRepo(selectedRepo)
        }
        break
    }
  }

  // Handle keyboard navigation for branch dropdown
  const handleBranchKeyDown = (e: React.KeyboardEvent) => {
    if (filteredBranches.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedBranchIndex((prev) => Math.min(prev + 1, filteredBranches.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedBranchIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        const selectedBranchItem = filteredBranches[selectedBranchIndex]
        if (selectedBranchItem) {
          handleSelectBranchFromDropdown(selectedBranchItem)
        }
        break
      case "Escape":
        e.preventDefault()
        setShowBranchDropdown(false)
        setBranchSearch("")
        break
    }
  }

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
              if (mode === "create") {
                // Focus the Name input when opening the Create form.
                const input = document.querySelector<HTMLInputElement>(
                  "[data-repo-create-name]"
                )
                input?.focus()
                input?.select()
              } else if (mode === "branch-only") {
                // Branch-only mode: focus the branch search input
                branchSearchInputRef.current?.focus()
              } else {
                searchInputRef.current?.focus()
              }
            }, 0)
          }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col",
            // Allow overflow when branch dropdown is open so it's not clipped
            showBranchDropdown ? "overflow-visible" : "overflow-hidden",
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

          <ModalHeader
            title={step === "branch" ? "Select Branch" : activeTab === "create" ? "Create Repository" : "Select Repository"}
          />

          {/* Breadcrumb for branch step */}
          {step === "branch" && selectedRepo && (
            <div className={cn(
              "border-b border-border bg-muted/30",
              isMobile ? "px-4 py-3" : "px-4 py-2"
            )}>
              {!isBranchOnly && (
                <button
                  onClick={() => setStep("repo")}
                  className={cn(
                    "flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors",
                    isMobile ? "text-sm" : "text-xs"
                  )}
                >
                  <ChevronLeft className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                  Back to repositories
                </button>
              )}
              <div className={cn(
                "font-medium",
                isMobile ? "text-base" : "text-sm",
                !isBranchOnly && "mt-1"
              )}>
                {selectedRepo.full_name}
              </div>
            </div>
          )}

          {/* Search (with a + button on the right that switches to Create). */}
          {step === "repo" && activeTab === "select" && (
            <div className={cn(
              "border-b border-border",
              isMobile ? "p-4" : "p-4"
            )}>
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={searchInputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleRepoKeyDown}
                    placeholder="Search repositories..."
                    className="pl-8"
                  />
                </div>
                {onRequestCreate && (
                  <button
                    onClick={() => { onClose(); onRequestCreate() }}
                    className={cn(
                      "flex-shrink-0 flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                      isMobile ? "h-11 w-11" : "h-8 w-8"
                    )}
                    title="Create a new repository"
                    aria-label="Create a new repository"
                  >
                    <Plus className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Content */}
          <div
            ref={contentRef}
            className={cn(
              "flex-1 mobile-scroll",
              isMobile ? "max-h-none" : "max-h-80",
              // Allow overflow when branch dropdown is open so it's not clipped
              showBranchDropdown ? "overflow-visible" : "overflow-y-auto"
            )}
          >
            {error && activeTab !== "create" && (
              <div className={cn(
                "text-destructive text-center",
                isMobile ? "p-6 text-base" : "p-4 text-sm"
              )}>
                {error}
              </div>
            )}

            {loading && activeTab === "select" && (
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

            {!loading && !error && step === "repo" && activeTab === "select" && (
              <div className={cn(isMobile ? "p-3" : "p-2")}>
                {filteredRepos.length === 0 ? (
                  <div className={cn(
                    "text-muted-foreground text-center",
                    isMobile ? "p-6 text-base" : "p-4 text-sm"
                  )}>
                    No repositories found
                  </div>
                ) : (
                  filteredRepos.map((repo, index) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className={cn(
                        "flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors text-left touch-target",
                        isMobile ? "px-4 py-4" : "px-3 py-2",
                        index === selectedRepoIndex && "bg-accent"
                      )}
                    >
                      {repo.private ? (
                        <Lock className={cn(
                          "text-muted-foreground shrink-0",
                          isMobile ? "h-5 w-5" : "h-4 w-4"
                        )} />
                      ) : (
                        <Globe className={cn(
                          "text-muted-foreground shrink-0",
                          isMobile ? "h-5 w-5" : "h-4 w-4"
                        )} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={cn(
                          "font-medium truncate",
                          isMobile ? "text-base" : "text-sm"
                        )}>
                          {repo.full_name}
                        </div>
                        <div className={cn(
                          "text-muted-foreground",
                          isMobile ? "text-sm" : "text-xs"
                        )}>
                          Default: {repo.default_branch}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Create Repository Form */}
            {step === "repo" && activeTab === "create" && (
              <div className={cn(isMobile ? "p-4" : "p-4")}>
                {error && (
                  <div className={cn(
                    "text-destructive mb-4 p-3 bg-destructive/10 rounded-md",
                    isMobile ? "text-base" : "text-sm"
                  )}>
                    {error}
                  </div>
                )}

                <div className="space-y-5">
                  {/* Repository Name */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium block">
                      Name <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="text"
                      data-repo-create-name
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-new-repo"
                      disabled={creating}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium block">
                      Description
                    </label>
                    <Input
                      type="text"
                      value={newRepoDescription}
                      onChange={(e) => setNewRepoDescription(e.target.value)}
                      placeholder="Optional"
                      disabled={creating}
                    />
                  </div>

                  {/* Visibility */}
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium block">Visibility</span>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRepoIsPrivate}
                        onChange={(e) => setNewRepoIsPrivate(e.target.checked)}
                        disabled={creating}
                        className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
                      />
                      <span className="text-sm">Private</span>
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-3">
                    <button
                      onClick={onClose}
                      disabled={creating}
                      className="rounded-md hover:bg-accent transition-colors disabled:opacity-50 px-3 py-1.5 text-sm cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateRepo}
                      disabled={creating || !newRepoName.trim()}
                      className="bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer"
                    >
                      {creating && <Loader2 className="animate-spin h-3.5 w-3.5" />}
                      {creating ? "Creating..." : "Create"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!loading && !error && step === "branch" && (
              <div className={cn(isMobile ? "p-4" : "p-4")}>
                <div className={cn(isMobile ? "mb-6" : "mb-4")}>
                  <label className={cn(
                    "block font-medium mb-2",
                    isMobile ? "text-base" : "text-sm"
                  )}>
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
                        <GitBranch className={cn(
                          "text-muted-foreground",
                          isMobile ? "h-5 w-5" : "h-4 w-4"
                        )} />
                        {selectedBranch}
                      </span>
                      <ChevronDown className={cn(
                        "text-muted-foreground",
                        isMobile ? "h-5 w-5" : "h-4 w-4"
                      )} />
                    </button>

                    {showBranchDropdown && (
                      <div className={cn(
                        "absolute left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-[200] overflow-hidden flex flex-col",
                        isMobile ? "max-h-72" : "max-h-60"
                      )}>
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
                            <div className={cn(
                              "text-muted-foreground text-center",
                              isMobile ? "p-4 text-base" : "p-2 text-sm"
                            )}>
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
                                  (index === selectedBranchIndex || branch.name === selectedBranch) && "bg-accent"
                                )}
                              >
                                <GitBranch className={cn(
                                  "text-muted-foreground",
                                  isMobile ? "h-4 w-4" : "h-3 w-3"
                                )} />
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
                    onClick={() => isBranchOnly ? onClose() : setStep("repo")}
                    className={cn(
                      "rounded-md hover:bg-accent active:bg-accent transition-colors touch-target",
                      isMobile ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
                    )}
                  >
                    {isBranchOnly ? "Cancel" : "Back"}
                  </button>
                  <button
                    onClick={handleConfirm}
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
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
