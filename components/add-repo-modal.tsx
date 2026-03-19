"use client"

import { Github, X, Loader2, Search, Lock, GitFork, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import type { Repo } from "@/lib/types"
import { generateId } from "@/lib/store"

interface GitHubRepo {
  fullName: string
  name: string
  owner: string
  avatar: string
  defaultBranch: string
  private: boolean
  description: string | null
  canPush: boolean
}

interface AddRepoModalProps {
  open: boolean
  onClose: () => void
  githubUser: string | null
  existingRepos: Repo[]
  onAddRepo: (repo: Repo) => void | Promise<void>
  onSelectExistingRepo: (repoId: string) => void
}

export function AddRepoModal({ open, onClose, githubUser, existingRepos, onAddRepo, onSelectExistingRepo }: AddRepoModalProps) {
  const [mode, setMode] = useState<"select" | "url" | "create">("select")
  const [url, setUrl] = useState("")
  const [search, setSearch] = useState("")
  const [userRepos, setUserRepos] = useState<GitHubRepo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forkPrompt, setForkPrompt] = useState<{ owner: string; name: string; avatar: string; defaultBranch: string } | null>(null)
  const [newRepoName, setNewRepoName] = useState("")
  const [newRepoDescription, setNewRepoDescription] = useState("")
  const [newRepoPrivate, setNewRepoPrivate] = useState(false)

  // Fetch user repos when modal opens in select mode
  useEffect(() => {
    if (open && mode === "select") {
      setLoadingRepos(true)
      fetch("/api/github/repos")
        .then((r) => r.json())
        .then((data) => {
          if (data.repos) setUserRepos(data.repos)
        })
        .catch(() => {})
        .finally(() => setLoadingRepos(false))
    }
  }, [open, mode])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setUrl("")
      setSearch("")
      setError(null)
      setForkPrompt(null)
      setLoading(false)
      setNewRepoName("")
      setNewRepoDescription("")
      setNewRepoPrivate(false)
    }
  }, [open])

  if (!open) return null

  function parseGitHubUrl(input: string): { owner: string; name: string } | null {
    const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "")
    const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (urlMatch) return { owner: urlMatch[1], name: urlMatch[2] }
    const shortMatch = trimmed.match(/^([^/]+)\/([^/]+)$/)
    if (shortMatch) return { owner: shortMatch[1], name: shortMatch[2] }
    return null
  }

  async function addRepoByInfo(info: { name: string; owner: string; avatar: string; defaultBranch: string }) {
    // Check if repo already exists — if so, just select it
    const existing = existingRepos.find(
      (r) => r.owner.toLowerCase() === info.owner.toLowerCase() && r.name.toLowerCase() === info.name.toLowerCase()
    )
    if (existing) {
      onSelectExistingRepo(existing.id)
      onClose()
      return
    }
    const repo: Repo = {
      id: generateId(),
      name: info.name,
      owner: info.owner,
      avatar: info.avatar,
      defaultBranch: info.defaultBranch,
      branches: [],
    }
    try {
      await onAddRepo(repo)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add repository")
    }
  }

  async function handleAddByUrl() {
    const parsed = parseGitHubUrl(url)
    if (!parsed) {
      setError("Invalid format. Use https://github.com/owner/repo or owner/repo")
      return
    }
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ owner: parsed.owner, name: parsed.name })

      const res = await fetch(`/api/github/repo?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to fetch repository")

      // Check if user has push access to the repo
      if (!data.canPush) {
        setForkPrompt({
          owner: data.owner,
          name: data.name,
          avatar: data.avatar,
          defaultBranch: data.defaultBranch,
        })
        setLoading(false)
        return
      }

      await addRepoByInfo(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add repository")
    } finally {
      setLoading(false)
    }
  }

  async function handleFork() {
    if (!forkPrompt) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/github/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: forkPrompt.owner,
          name: forkPrompt.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to fork repository")
      await addRepoByInfo(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fork")
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectRepo(repo: GitHubRepo) {
    if (!repo.canPush) {
      setForkPrompt({
        owner: repo.owner,
        name: repo.name,
        avatar: repo.avatar,
        defaultBranch: repo.defaultBranch,
      })
      return
    }
    await addRepoByInfo(repo)
  }

  async function handleCreateRepo() {
    const name = newRepoName.trim()
    if (!name || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/github/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: newRepoDescription.trim() || undefined,
          isPrivate: newRepoPrivate,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to create repository")
      await addRepoByInfo(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create repository")
    } finally {
      setLoading(false)
    }
  }

  const filteredRepos = userRepos.filter(
    (r) =>
      r.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  )

  // Fork confirmation view
  if (forkPrompt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh]">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Fork Required</h2>
            </div>
            <button onClick={onClose} className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5">
            <p className="text-sm text-foreground mb-2">
              You don&apos;t own <span className="font-mono font-semibold">{forkPrompt.owner}/{forkPrompt.name}</span>.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Agents need push access. A fork will be created under your account so the agent can commit and push changes.
            </p>
            {error && <p className="text-[11px] text-red-400 mb-3">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button onClick={() => { setForkPrompt(null); setError(null) }} className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              Back
            </button>
            <button
              onClick={handleFork}
              disabled={loading}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              <GitFork className="h-3 w-3" />
              Fork & Add
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border px-4 sm:px-5 py-4">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Add Repository</h2>
          </div>
          <button onClick={onClose} className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setMode("select")}
            className={cn(
              "flex-1 px-4 py-2 text-xs font-medium transition-colors cursor-pointer",
              mode === "select" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Your Repos
          </button>
          <button
            onClick={() => setMode("url")}
            className={cn(
              "flex-1 px-4 py-2 text-xs font-medium transition-colors cursor-pointer",
              mode === "url" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            By URL
          </button>
          <button
            onClick={() => setMode("create")}
            className={cn(
              "flex-1 px-4 py-2 text-xs font-medium transition-colors cursor-pointer",
              mode === "create" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Create New
          </button>
        </div>

        {mode === "select" ? (
          <div className="flex flex-col">
            {/* Search */}
            <div className="px-4 py-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 bg-secondary border-none pl-8 text-xs placeholder:text-muted-foreground/60"
                  autoFocus
                />
              </div>
            </div>
            {/* Repo list */}
            <div className="max-h-[300px] overflow-y-auto">
              {loadingRepos ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No repos found
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => handleSelectRepo(repo)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <img src={repo.avatar} alt="" className="h-6 w-6 rounded" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-xs font-medium text-foreground truncate">{repo.fullName}</span>
                      {repo.description && (
                        <span className="text-[10px] text-muted-foreground truncate">{repo.description}</span>
                      )}
                    </div>
                    {repo.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : mode === "url" ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">GitHub Repository</label>
              <Input
                type="text"
                placeholder="owner/repo or https://github.com/owner/repo"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleAddByUrl() }}
                className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                autoFocus
                disabled={loading}
              />
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              {!error && (
                <p className="text-[11px] text-muted-foreground">
                  If you don&apos;t own the repo, you&apos;ll be prompted to fork it.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleAddByUrl}
                disabled={loading || !url.trim()}
                className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Add
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Repository name</label>
              <Input
                type="text"
                placeholder="my-project"
                value={newRepoName}
                onChange={(e) => { setNewRepoName(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleCreateRepo() }}
                className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                autoFocus
                disabled={loading}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                type="text"
                placeholder="A short description"
                value={newRepoDescription}
                onChange={(e) => setNewRepoDescription(e.target.value)}
                className="h-9 bg-secondary border-border text-xs placeholder:text-muted-foreground/40"
                disabled={loading}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newRepoPrivate}
                onChange={(e) => setNewRepoPrivate(e.target.checked)}
                className="rounded border-border"
                disabled={loading}
              />
              <span className="text-xs text-foreground">Private repository</span>
            </label>
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCreateRepo}
                disabled={loading || !newRepoName.trim()}
                className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                <Plus className="h-3 w-3" />
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
