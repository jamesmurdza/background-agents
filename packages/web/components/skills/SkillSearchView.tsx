"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Search, X, Check, Loader2, Zap, Trash2, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Skill, SkillSearchResult } from "@/lib/types"

interface SkillSearchViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatId: string
  repo: string
}

export function SkillSearchView({ open, onOpenChange, chatId, repo }: SkillSearchViewProps) {
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<(SkillSearchResult & { installs?: number })[]>([])
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set())
  const [isSearching, setIsSearching] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ installed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"search" | "installed">("search")
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch installed skills on open
  useEffect(() => {
    if (!open) return
    fetchInstalledSkills()
    // Focus input on open
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [open, repo])

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setQuery("")
      setSearchResults([])
      setSelectedHandles(new Set())
      setError(null)
      setInstallProgress(null)
      setActiveTab("search")
    }
  }, [open])

  const fetchInstalledSkills = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills?repo=${encodeURIComponent(repo)}`)
      if (res.ok) {
        const data = await res.json()
        setInstalledSkills(data.skills ?? [])
      }
    } catch {
      // Silent fail — non-critical
    }
  }, [repo])

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (!query.trim()) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    setError(null) // Clear any stale install/search errors
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skills/search?q=${encodeURIComponent(query.trim())}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.results ?? [])
          setError(null) // Clear errors on successful search
        } else {
          setError("Search failed — registry may be unavailable")
          setSearchResults([])
        }
      } catch {
        setError("Search failed — check your connection")
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [query])

  const toggleSelection = (fullHandle: string) => {
    setSelectedHandles((prev) => {
      const next = new Set(prev)
      if (next.has(fullHandle)) next.delete(fullHandle)
      else next.add(fullHandle)
      return next
    })
  }

  const isAlreadyInstalled = (fullHandle: string) => {
    return installedSkills.some((s) => s.fullHandle === fullHandle)
  }

  const handleInstallSelected = async () => {
    if (selectedHandles.size === 0) return
    setIsInstalling(true)
    setError(null)
    setInstallProgress({ installed: 0, total: selectedHandles.size })

    try {
      // Build skill objects from search results
      const skillsToInstall = searchResults
        .filter((r) => selectedHandles.has(r.fullHandle))
        .map((r) => ({
          publisher: r.publisher,
          name: r.name,
          fullHandle: r.fullHandle,
          url: r.url,
        }))

      // Step 1: Save to DB
      const saveRes = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, skills: skillsToInstall }),
      })

      if (!saveRes.ok) {
        throw new Error("Failed to save skills")
      }

      // Step 2: Install in sandbox (includes --list pre-validation)
      const installRes = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      })

      if (installRes.ok) {
        const result = await installRes.json()
        const installedCount = result.installed ?? 0
        setInstallProgress({ installed: installedCount, total: result.total })

        // Surface per-skill failures
        const failures = (result.results ?? []).filter(
          (r: { success: boolean; error?: string }) => !r.success
        )
        if (failures.length > 0) {
          const failMsgs = failures.map(
            (f: { fullHandle: string; error?: string }) =>
              `${f.fullHandle}: ${f.error ?? "unknown error"}`
          )
          setError(`${failures.length} skill(s) failed:\n${failMsgs.join("\n")}`)
        }

        // Refresh installed list and clear selection
        await fetchInstalledSkills()
        setSelectedHandles(new Set())

        // Show installed tab only if at least one skill succeeded
        setTimeout(() => {
          if (installedCount > 0) {
            setActiveTab("installed")
          }
          setInstallProgress(null)
        }, 2000)
      } else {
        throw new Error("Install request failed")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Installation failed")
      setInstallProgress(null)
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUninstall = async (skillId: string) => {
    try {
      const res = await fetch(`/api/skills/${skillId}?chatId=${encodeURIComponent(chatId)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setInstalledSkills((prev) => prev.filter((s) => s.id !== skillId))
      }
    } catch {
      setError("Failed to uninstall skill")
    }
  }

  if (!open) return null

  const selectableResults = searchResults.filter((r) => !isAlreadyInstalled(r.fullHandle))
  const selectedCount = selectedHandles.size

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="fixed inset-x-0 top-[15vh] z-50 mx-auto w-full max-w-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200">
        <div className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-foreground">Skills</span>
            <span className="text-xs text-muted-foreground">
              {repo}
            </span>
            <div className="flex-1" />
            {installedSkills.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {installedSkills.length} installed
              </span>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab("search")}
              className={cn(
                "flex-1 px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "search"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Search
            </button>
            <button
              onClick={() => setActiveTab("installed")}
              className={cn(
                "flex-1 px-4 py-2 text-sm font-medium transition-colors relative",
                activeTab === "installed"
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Installed
              {installedSkills.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({installedSkills.length})
                </span>
              )}
            </button>
          </div>

          {activeTab === "search" && (
            <>
              {/* Search Input */}
              <div className="relative px-4 py-3 border-b border-border">
                <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search skills..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground"
                  autoFocus
                />
                {isSearching && (
                  <Loader2 className="absolute right-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                )}
              </div>

              {/* Search Results */}
              <div className="max-h-[40vh] overflow-y-auto scrollbar-auto-hide">
                {error && (
                  <div className="px-4 py-3 text-sm text-destructive bg-destructive/10">
                    {error}
                  </div>
                )}

                {!query.trim() && !isSearching && searchResults.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Search the Skills.sh registry to find skills for your agent
                  </div>
                )}

                {query.trim() && !isSearching && searchResults.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No skills found for &ldquo;{query}&rdquo;
                  </div>
                )}

                {searchResults.map((result) => {
                  const installed = isAlreadyInstalled(result.fullHandle)
                  const selected = selectedHandles.has(result.fullHandle)
                  return (
                    <button
                      key={result.fullHandle}
                      onClick={() => !installed && toggleSelection(result.fullHandle)}
                      disabled={installed || isInstalling}
                      className={cn(
                        "flex items-start gap-3 w-full px-4 py-3 text-left transition-colors",
                        installed
                          ? "opacity-50 cursor-default"
                          : selected
                            ? "bg-primary/5"
                            : "hover:bg-accent/50 cursor-pointer"
                      )}
                    >
                      {/* Checkbox */}
                      <div
                        className={cn(
                          "mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors",
                          installed
                            ? "border-muted-foreground/30 bg-muted"
                            : selected
                              ? "border-primary bg-primary"
                              : "border-border"
                        )}
                      >
                        {(installed || selected) && (
                          <Check className="h-4 w-4 text-primary-foreground" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {result.fullHandle}
                          </span>
                          {installed && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Installed
                            </span>
                          )}
                          {result.installs != null && result.installs > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {result.installs.toLocaleString()} installs
                            </span>
                          )}
                        </div>
                        {result.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {result.description}
                          </p>
                        )}
                      </div>

                      {/* External link */}
                      {result.url && (
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 flex-shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Install Bar */}
              {(selectedCount > 0 || installProgress) && (
                <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-accent/30">
                  {installProgress ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm text-foreground">
                        Installing {installProgress.installed}/{installProgress.total} skills…
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{
                            width: `${installProgress.total > 0 ? (installProgress.installed / installProgress.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm text-muted-foreground">
                        {selectedCount} skill{selectedCount !== 1 ? "s" : ""} selected
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setSelectedHandles(new Set())}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={handleInstallSelected}
                        disabled={isInstalling}
                        className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Install selected
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "installed" && (
            <div className="max-h-[50vh] overflow-y-auto scrollbar-auto-hide">
              {installedSkills.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No skills installed for this repo.
                  <br />
                  <button
                    onClick={() => setActiveTab("search")}
                    className="mt-2 text-primary hover:underline"
                  >
                    Search for skills →
                  </button>
                </div>
              ) : (
                installedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors group"
                  >
                    <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {skill.fullHandle}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Installed {new Date(skill.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    {skill.url && (
                      <a
                        href={skill.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleUninstall(skill.id)}
                      className="flex-shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Uninstall skill"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
