"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Search, GitBranch, Loader2, Lock, Globe, ChevronDown, ChevronLeft, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchRepos, fetchBranches, createRepository } from "@/lib/github"
import type { GitHubRepo, GitHubBranch } from "@/lib/types"

interface RepoPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (repo: string, branch: string) => void
  isMobile?: boolean
  /** Whether to allow selecting an existing repo (before chat starts) */
  allowSelect?: boolean
  /** Whether to allow creating a new repo */
  allowCreate?: boolean
}

type Step = "repo" | "branch" | "create"
type Tab = "select" | "create"

const SWIPE_THRESHOLD = 100 // Minimum swipe distance to dismiss

export function RepoPickerModal({ open, onClose, onSelect, isMobile = false, allowSelect = true, allowCreate = false }: RepoPickerModalProps) {
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
  const [newRepoIsPrivate, setNewRepoIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)

  // Swipe gesture state
  const contentRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Fetch repos on open
  useEffect(() => {
    if (open && session?.accessToken) {
      setLoading(true)
      setError(null)
      fetchRepos(session.accessToken)
        .then(setRepos)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [open, session?.accessToken])

  // Reset state on close/open - set correct initial tab
  useEffect(() => {
    if (!open) {
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
      setNewRepoIsPrivate(false)
      setCreating(false)
    }
  }, [open])

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

  // Fetch branches when repo selected
  const handleSelectRepo = async (repo: GitHubRepo) => {
    if (!session?.accessToken) return

    setSelectedRepo(repo)
    setSelectedBranch(repo.default_branch)
    setStep("branch")
    setLoading(true)
    setError(null)
    setSearch("")

    try {
      const branchList = await fetchBranches(
        session.accessToken,
        repo.owner.login,
        repo.name
      )
      setBranches(branchList)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch branches")
    } finally {
      setLoading(false)
    }
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

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300",
          isMobile ? "bg-black/50" : "bg-black/50",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-lg shadow-lg",
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

          {/* Header */}
          <div className={cn(
            "flex items-center justify-between border-b border-border",
            isMobile ? "px-4 py-3" : "px-4 py-3"
          )}>
            <Dialog.Title className={cn(
              "font-semibold",
              isMobile ? "text-lg" : "text-sm"
            )}>
              {step === "branch" ? "Select Branch" : activeTab === "create" ? "Create Repository" : "Select Repository"}
            </Dialog.Title>
            <Dialog.Close className={cn(
              "rounded-lg hover:bg-accent active:bg-accent transition-colors touch-target",
              isMobile ? "p-2 -mr-2" : "p-1"
            )}>
              <X className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
            </Dialog.Close>
          </div>

          {/* Tabs - only show on repo step when both select and create are allowed */}
          {step === "repo" && allowSelect && allowCreate && (
            <div className={cn(
              "flex border-b border-border",
              isMobile ? "px-4" : "px-4"
            )}>
              <button
                onClick={() => { setActiveTab("select"); setError(null) }}
                className={cn(
                  "flex-1 py-2 text-center transition-colors relative",
                  isMobile ? "text-base" : "text-sm",
                  activeTab === "select"
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Select Existing
                {activeTab === "select" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
              <button
                onClick={() => { setActiveTab("create"); setError(null) }}
                className={cn(
                  "flex-1 py-2 text-center transition-colors relative",
                  isMobile ? "text-base" : "text-sm",
                  activeTab === "create"
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center justify-center gap-1">
                  <Plus className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                  Create New
                </span>
                {activeTab === "create" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            </div>
          )}

          {/* Breadcrumb for branch step */}
          {step === "branch" && selectedRepo && (
            <div className={cn(
              "border-b border-border bg-muted/30",
              isMobile ? "px-4 py-3" : "px-4 py-2"
            )}>
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
              <div className={cn(
                "font-medium mt-1",
                isMobile ? "text-base" : "text-sm"
              )}>
                {selectedRepo.full_name}
              </div>
            </div>
          )}

          {/* Search - only for repo step and select tab */}
          {step === "repo" && activeTab === "select" && (
            <div className={cn(
              "border-b border-border",
              isMobile ? "p-4" : "p-4"
            )}>
              <div className="relative">
                <Search className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground",
                  isMobile ? "h-5 w-5" : "h-4 w-4"
                )} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search repositories..."
                  className={cn(
                    "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
                    isMobile ? "pl-11 pr-4 py-3 text-base" : "pl-9 pr-4 py-2 text-sm"
                  )}
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div
            ref={contentRef}
            className={cn(
              "flex-1 overflow-y-auto mobile-scroll",
              isMobile ? "max-h-none" : "max-h-80"
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
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className={cn(
                        "flex items-center gap-3 w-full rounded-lg hover:bg-accent active:bg-accent transition-colors text-left touch-target",
                        isMobile ? "px-4 py-4" : "px-3 py-2"
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

                <div className={cn(isMobile ? "space-y-5" : "space-y-4")}>
                  {/* Repository Name */}
                  <div>
                    <label className={cn(
                      "block font-medium mb-2",
                      isMobile ? "text-base" : "text-sm"
                    )}>
                      Repository Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      placeholder="my-new-repo"
                      disabled={creating}
                      className={cn(
                        "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
                        isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
                      )}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className={cn(
                      "block font-medium mb-2",
                      isMobile ? "text-base" : "text-sm"
                    )}>
                      Description <span className="text-muted-foreground font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={newRepoDescription}
                      onChange={(e) => setNewRepoDescription(e.target.value)}
                      placeholder="A short description of the repository"
                      disabled={creating}
                      className={cn(
                        "w-full bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
                        isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
                      )}
                    />
                  </div>

                  {/* Visibility */}
                  <div>
                    <label className={cn(
                      "block font-medium mb-2",
                      isMobile ? "text-base" : "text-sm"
                    )}>
                      Visibility
                    </label>
                    <div className={cn(
                      "flex gap-2",
                      isMobile ? "flex-col" : "flex-row"
                    )}>
                      <button
                        type="button"
                        onClick={() => setNewRepoIsPrivate(false)}
                        disabled={creating}
                        className={cn(
                          "flex items-center gap-2 border rounded-md transition-colors disabled:opacity-50",
                          isMobile ? "px-4 py-3 text-base flex-1" : "px-3 py-2 text-sm",
                          !newRepoIsPrivate
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border hover:bg-accent"
                        )}
                      >
                        <Globe className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
                        Public
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewRepoIsPrivate(true)}
                        disabled={creating}
                        className={cn(
                          "flex items-center gap-2 border rounded-md transition-colors disabled:opacity-50",
                          isMobile ? "px-4 py-3 text-base flex-1" : "px-3 py-2 text-sm",
                          newRepoIsPrivate
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border hover:bg-accent"
                        )}
                      >
                        <Lock className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
                        Private
                      </button>
                    </div>
                  </div>

                  {/* Create Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleCreateRepo}
                      disabled={creating || !newRepoName.trim()}
                      className={cn(
                        "bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 flex items-center gap-2 touch-target",
                        isMobile ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
                      )}
                    >
                      {creating && <Loader2 className={cn("animate-spin", isMobile ? "h-5 w-5" : "h-4 w-4")} />}
                      {creating ? "Creating..." : "Create Repository"}
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
                        "absolute left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-[200] overflow-y-auto",
                        isMobile ? "max-h-60" : "max-h-48"
                      )}>
                        {branches.length === 0 ? (
                          <div className={cn(
                            "text-muted-foreground text-center",
                            isMobile ? "p-4 text-base" : "p-2 text-sm"
                          )}>
                            No branches found
                          </div>
                        ) : (
                          branches.map((branch) => (
                            <button
                              key={branch.name}
                              onClick={() => handleSelectBranchFromDropdown(branch)}
                              className={cn(
                                "flex items-center gap-2 w-full text-left hover:bg-accent active:bg-accent transition-colors touch-target",
                                isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm",
                                branch.name === selectedBranch && "bg-accent"
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
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setStep("repo")}
                    className={cn(
                      "rounded-md hover:bg-accent active:bg-accent transition-colors touch-target",
                      isMobile ? "px-6 py-3 text-base" : "px-4 py-2 text-sm"
                    )}
                  >
                    Back
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
