"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Search, GitBranch, Loader2, Lock, Globe } from "lucide-react"
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

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
      setBranches([])
      setSearch("")
      setError(null)
    }
  }, [open])

  // Fetch branches when repo selected
  const handleSelectRepo = async (repo: GitHubRepo) => {
    if (!session?.accessToken) return

    setSelectedRepo(repo)
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

  // Handle branch selection
  const handleSelectBranch = (branch: GitHubBranch) => {
    if (!selectedRepo) return
    onSelect(selectedRepo.full_name, branch.name)
    onClose()
  }

  // Filter items by search
  const filteredRepos = repos.filter((repo) =>
    repo.full_name.toLowerCase().includes(search.toLowerCase())
  )
  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-popover border border-border rounded-lg shadow-lg z-50">
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

          {/* Search */}
          <div className="p-4 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={step === "repo" ? "Search repositories..." : "Search branches..."}
                className="w-full pl-9 pr-4 py-2 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

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
              <div className="p-2">
                {filteredBranches.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No branches found
                  </div>
                ) : (
                  filteredBranches.map((branch) => (
                    <button
                      key={branch.name}
                      onClick={() => handleSelectBranch(branch)}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {branch.name}
                        </div>
                        {branch.protected && (
                          <div className="text-xs text-muted-foreground">
                            Protected
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
