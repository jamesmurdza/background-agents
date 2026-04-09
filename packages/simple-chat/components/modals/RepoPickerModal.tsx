"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Search, GitBranch, Loader2, Lock, Globe, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchRepos, fetchBranches } from "@/lib/github"
import type { GitHubRepo, GitHubBranch } from "@/lib/types"

interface RepoPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (repo: string, branch: string) => void
}

type Step = "repo" | "branch"

export function RepoPickerModal({ open, onClose, onSelect }: RepoPickerModalProps) {
  const { data: session } = useSession()

  const [step, setStep] = useState<Step>("repo")
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string>("")
  const [showBranchDropdown, setShowBranchDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [branchSearch, setBranchSearch] = useState("")

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

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setStep("repo")
      setSelectedRepo(null)
      setSelectedBranch("")
      setBranches([])
      setSearch("")
      setBranchSearch("")
      setShowBranchDropdown(false)
      setError(null)
    }
  }, [open])

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
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-popover border border-border rounded-lg shadow-lg z-50 overflow-visible">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold">
              {step === "repo" ? "Select Repository" : "Select Branch"}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Breadcrumb for branch step */}
          {step === "branch" && selectedRepo && (
            <div className="px-4 py-2 border-b border-border bg-muted/30">
              <button
                onClick={() => setStep("repo")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back to repositories
              </button>
              <div className="text-sm font-medium mt-1">{selectedRepo.full_name}</div>
            </div>
          )}

          {/* Search - only for repo step */}
          {step === "repo" && (
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search repositories..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {error && (
              <div className="p-4 text-sm text-destructive text-center">
                {error}
              </div>
            )}

            {loading && (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loading && !error && step === "repo" && (
              <div className="p-2">
                {filteredRepos.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No repositories found
                  </div>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      {repo.private ? (
                        <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {repo.full_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Default: {repo.default_branch}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {!loading && !error && step === "branch" && (
              <div className="p-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Base Branch</label>
                  <div className="relative">
                    <button
                      onClick={() => setShowBranchDropdown(!showBranchDropdown)}
                      className="flex items-center justify-between w-full px-3 py-2 text-sm border border-border rounded-md hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-muted-foreground" />
                        {selectedBranch}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>

                    {showBranchDropdown && (
                      <div className="fixed mt-1 bg-popover border border-border rounded-md shadow-lg z-[200] max-h-48 overflow-y-auto w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)]" style={{ marginTop: '4px' }}>
                        {branches.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            No branches found
                          </div>
                        ) : (
                          branches.map((branch) => (
                            <button
                              key={branch.name}
                              onClick={() => handleSelectBranchFromDropdown(branch)}
                              className={cn(
                                "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors text-left cursor-pointer",
                                branch.name === selectedBranch && "bg-accent"
                              )}
                            >
                              <GitBranch className="h-3 w-3 text-muted-foreground" />
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
                    className="px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={!selectedBranch}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
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
