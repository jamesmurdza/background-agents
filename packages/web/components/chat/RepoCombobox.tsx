"use client"

import { useState, useEffect, useMemo } from "react"
import { Github, Lock, Globe, ChevronDown, Loader2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchRepos } from "@/lib/github"
import type { GitHubRepo } from "@/lib/types"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"

interface RepoComboboxProps {
  /** Current repo full_name (e.g. "owner/repo") or null if none selected */
  value: string | null
  /** Called when user selects a repo */
  onChange: (repo: string, defaultBranch: string) => void
  /** Optional: called when user clicks "Create new repository" */
  onRequestCreate?: () => void
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Mobile layout */
  isMobile?: boolean
  /** Always show label regardless of container width */
  showLabel?: boolean
}

export function RepoCombobox({
  value,
  onChange,
  onRequestCreate,
  disabled = false,
  isMobile = false,
  showLabel = false,
}: RepoComboboxProps) {
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  // Fetch repos when popover opens
  useEffect(() => {
    if (open && repos.length === 0 && !loading) {
      setLoading(true)
      setError(null)
      fetchRepos()
        .then(setRepos)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [open, repos.length, loading])

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch("")
    }
  }, [open])

  // Filter repos by search
  const filteredRepos = useMemo(() => {
    if (!search.trim()) return repos
    const searchLower = search.toLowerCase()
    return repos.filter((repo) =>
      repo.full_name.toLowerCase().includes(searchLower) ||
      repo.description?.toLowerCase().includes(searchLower)
    )
  }, [repos, search])

  // Get display label for current value
  const displayLabel = value ? value.split("/").pop() : "Repository"

  const handleSelectRepo = (repo: GitHubRepo) => {
    onChange(repo.full_name, repo.default_branch)
    setOpen(false)
  }

  const handleCreateClick = () => {
    setOpen(false)
    onRequestCreate?.()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer",
            isMobile ? "text-sm py-1 px-2 rounded-md hover:bg-accent/50" : "text-sm",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          title={value || "Select repository"}
        >
          <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <span className={cn(
            showLabel ? "inline" : (isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")
          )}>
            {displayLabel}
          </span>
          <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <Command shouldFilter={false} value={search ? undefined : (value || undefined)}>
          <CommandInput
            placeholder="Search repositories..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="py-6 text-center text-sm text-destructive">
                {error}
              </div>
            )}
            {!loading && !error && (
              <>
                {onRequestCreate && !search && (
                  <>
                    <CommandGroup>
                      <CommandItem
                        onSelect={handleCreateClick}
                        className="cursor-pointer"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create new repository
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                )}
                <CommandEmpty>No repositories found</CommandEmpty>
                <CommandGroup heading={repos.length > 0 ? "Your repositories" : undefined}>
                  {filteredRepos.map((repo) => (
                    <CommandItem
                      key={repo.full_name}
                      value={repo.full_name}
                      onSelect={() => handleSelectRepo(repo)}
                      className="flex items-center gap-2 cursor-pointer"
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
                          {repo.default_branch}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
