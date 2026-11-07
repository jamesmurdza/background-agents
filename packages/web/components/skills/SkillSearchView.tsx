"use client"

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Search, X, Check, Loader2, Zap, Trash2, ExternalLink, Upload, Sparkles } from "lucide-react"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import type { Skill, SkillSearchResult } from "@/lib/types"

interface SkillSearchViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatId: string
  repo: string
  hasSandbox: boolean
  isMobile?: boolean
}

export function SkillSearchView({ open, onOpenChange, chatId, repo, hasSandbox, isMobile = false }: SkillSearchViewProps) {
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<(SkillSearchResult & { installs?: number })[]>([])
  const [predefinedSkills, setPredefinedSkills] = useState<SkillSearchResult[]>([])
  const [installedSkills, setInstalledSkills] = useState<Skill[]>([])
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set())
  const [isSearching, setIsSearching] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ installed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [deleteSkill, setDeleteSkill] = useState<Skill | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const onClose = useCallback(() => onOpenChange(false), [onOpenChange])

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Fetch installed + predefined (built-in) skills on open
  useEffect(() => {
    if (!open) return
    fetchInstalledSkills()
    fetchPredefinedSkills()
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

  const fetchPredefinedSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/predefined")
      if (res.ok) {
        const data = await res.json()
        setPredefinedSkills(
          (data.results ?? []).map(
            (s: { id: string; name: string; description: string; fullHandle: string; url: string }) => ({
              publisher: "predefined",
              name: s.name,
              fullHandle: s.fullHandle,
              description: s.description,
              url: s.url,
            })
          )
        )
      }
    } catch {
      // Silent fail — non-critical
    }
  }, [])

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
      // Build skill objects from search results + featured/predefined skills
      const skillsToInstall = [...predefinedSkills, ...searchResults]
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

      // Before the first message there is no sandbox yet. The saved skills are
      // installed when that message creates it.
      if (!hasSandbox) {
        await fetchInstalledSkills()
        setSelectedHandles(new Set())
        setInstallProgress(null)
        return
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

        setTimeout(() => {
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

  const handleUploadZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // Let the same file be picked again after fixing it.
    if (!file) return

    setIsInstalling(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("chatId", chatId)
      form.append("file", file)
      const res = await fetch("/api/skills/upload", { method: "POST", body: form })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Upload failed")
      }
      await fetchInstalledSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUninstall = async (skill: Skill) => {
    setError(null)
    setRemovingId(skill.id)
    try {
      const res = await fetch(`/api/skills/${skill.id}?chatId=${encodeURIComponent(chatId)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setInstalledSkills((prev) => prev.filter((s) => s.id !== skill.id))
      } else {
        setError("Failed to uninstall skill")
      }
    } catch {
      setError("Failed to uninstall skill")
    } finally {
      setRemovingId(null)
    }
  }

  const selectedCount = selectedHandles.size
  const hasQuery = query.trim().length > 0

  // Installed skills that match the current query (filtered as the user types).
  const filteredInstalled = hasQuery
    ? installedSkills.filter((s) => s.fullHandle.toLowerCase().includes(query.trim().toLowerCase()))
    : installedSkills

  // Search results that aren't already installed — installed ones are shown via
  // the installed list above instead of duplicated here.
  const newResults = searchResults.filter((r) => !isAlreadyInstalled(r.fullHandle))

  // Featured/predefined skills that aren't already installed, filtered by the
  // current query just like everything else in the list.
  const newPredefined = predefinedSkills.filter(
    (r) =>
      !isAlreadyInstalled(r.fullHandle) &&
      (!hasQuery ||
        r.fullHandle.toLowerCase().includes(query.trim().toLowerCase()) ||
        r.description.toLowerCase().includes(query.trim().toLowerCase()))
  )

  const showEmptyState = !hasQuery && installedSkills.length === 0 && newPredefined.length === 0
  const showNoResults =
    hasQuery && !isSearching && filteredInstalled.length === 0 && newResults.length === 0 && newPredefined.length === 0

  const renderList = () => (
    <>
      {error && (
        <div className="px-4 py-3 text-sm text-destructive bg-destructive/10 whitespace-pre-line rounded-md">
          {error}
        </div>
      )}

      {showEmptyState && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No skills installed for this repo.
          <br />
          Search the Skills.sh registry above to find skills for your agent,
          or check back for featured skills.
        </div>
      )}

      {showNoResults && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No skills found for &ldquo;{query}&rdquo;
        </div>
      )}

      {/* Installed rows */}
      {filteredInstalled.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-3 px-1 py-3 hover:bg-accent/30 transition-colors group rounded-md"
        >
          <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {skill.fullHandle}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Installed
              </span>
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
              className="flex-shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={() => setDeleteSkill(skill)}
            disabled={removingId === skill.id}
            className={cn(
              "flex-shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100",
              removingId === skill.id && "opacity-100"
            )}
            title="Uninstall skill"
          >
            {removingId === skill.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      ))}

      {/* Featured/predefined (built-in) skill rows */}
      {newPredefined.map((result) => {
        const selected = selectedHandles.has(result.fullHandle)
        return (
          <button
            key={result.fullHandle}
            onClick={() => toggleSelection(result.fullHandle)}
            disabled={isInstalling}
            className={cn(
              "flex items-start gap-3 w-full px-1 py-3 text-left transition-colors rounded-md",
              selected ? "bg-primary/5" : "hover:bg-accent/50 cursor-pointer"
            )}
          >
            {/* Checkbox */}
            <div
              className={cn(
                "mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors",
                selected ? "border-primary bg-primary" : "border-border"
              )}
            >
              {selected && <Check className="h-4 w-4 text-primary-foreground" />}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {result.name}
                </span>
                <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-3 w-3" />
                  Featured
                </span>
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

      {/* New (not-yet-installed) search result rows */}
      {newResults.map((result) => {
        const selected = selectedHandles.has(result.fullHandle)
        return (
          <button
            key={result.fullHandle}
            onClick={() => toggleSelection(result.fullHandle)}
            disabled={isInstalling}
            className={cn(
              "flex items-start gap-3 w-full px-1 py-3 text-left transition-colors rounded-md",
              selected ? "bg-primary/5" : "hover:bg-accent/50 cursor-pointer"
            )}
          >
            {/* Checkbox */}
            <div
              className={cn(
                "mt-0.5 flex-shrink-0 h-4 w-4 rounded border transition-colors",
                selected ? "border-primary bg-primary" : "border-border"
              )}
            >
              {selected && <Check className="h-4 w-4 text-primary-foreground" />}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {result.fullHandle}
                </span>
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
    </>
  )

  const renderContent = () => (
    <>
      {/* Search Input */}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills..."
          className="w-full pl-9 pr-8 py-2 text-sm bg-muted/50 rounded-md border-none outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        {isSearching && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Combined list: installed skills (filtered by query) + new search results */}
      <div className="space-y-0.5">{renderList()}</div>

      {/* Install bar */}
      {(selectedCount > 0 || installProgress) && (
        <div className="flex items-center gap-3 mt-3 px-3 py-2.5 rounded-md bg-accent/30">
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
  )

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className={cn(
            MODAL_OVERLAY_CLASS,
            "transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )} />
          <Dialog.Content
            onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
            className={cn(
              "fixed z-50 bg-popover overflow-hidden flex flex-col",
              isMobile
                ? "inset-x-0 bottom-0 top-0 rounded-none"
                : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl h-[480px] max-h-[80vh] border border-border rounded-xl shadow-xl",
              !isDragging && isMobile && "transition-transform duration-300"
            )}
            style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
          >
            {isMobile ? (
              <>
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1" {...dragHandlers}>
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>

                {/* Header - also draggable */}
                <div
                  className="sticky top-0 flex items-center justify-between border-b border-border bg-popover z-10 px-4 py-3"
                  {...dragHandlers}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Dialog.Title className="font-semibold text-lg">Skills</Dialog.Title>
                    <span className="text-xs text-muted-foreground truncate">{repo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {installedSkills.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {installedSkills.length} installed
                      </span>
                    )}
                    <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target cursor-pointer">
                      <X className="h-5 w-5" />
                    </Dialog.Close>
                  </div>
                </div>

                {/* Content */}
                <div className="relative flex-1 overflow-y-auto mobile-scroll p-4">
                  {renderContent()}
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-popover px-4 py-4 pb-safe">
                  <span className="text-sm text-muted-foreground">
                    {hasSandbox ? "Upload a .zip with its SKILL.md and files." : "Send a message first to upload."}
                  </span>
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    disabled={isInstalling || !hasSandbox}
                    className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors touch-target px-4 py-2.5 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {isInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload
                  </button>
                  <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleUploadZip} />
                </div>
              </>
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Header with close button and title */}
                <div className="flex items-center justify-between px-5 pt-4 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Dialog.Title className="text-lg font-semibold">Skills</Dialog.Title>
                    <span className="text-xs text-muted-foreground truncate">{repo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {installedSkills.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {installedSkills.length} installed
                      </span>
                    )}
                    <Dialog.Close
                      className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </Dialog.Close>
                  </div>
                </div>

                {/* Content */}
                <div className="relative flex-1 overflow-y-auto px-5 pt-2 pb-4">
                  {renderContent()}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                  <span className="text-sm text-muted-foreground">
                    {hasSandbox
                      ? "Upload your own skill: a .zip with its SKILL.md and files."
                      : "Send a message first to upload your own .zip skill."}
                  </span>
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    disabled={isInstalling || !hasSandbox}
                    className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
                  >
                    {isInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Upload .zip
                  </button>
                  <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleUploadZip} />
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={!!deleteSkill}
        title="Remove skill"
        description={`Remove the ${deleteSkill?.name} skill from this repo?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => deleteSkill && handleUninstall(deleteSkill)}
        onClose={() => setDeleteSkill(null)}
      />
    </>
  )
}
