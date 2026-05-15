"use client"

import { useState, useEffect, useMemo } from "react"
import { GitBranch, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchBranches } from "@/lib/github"
import type { GitHubBranch } from "@/lib/types"
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
} from "@/components/ui/command"

interface BranchComboboxProps {
  /** Repository in "owner/repo" format */
  repo: string
  /** Current branch name */
  value: string
  /** Called when user selects a branch */
  onChange: (branch: string) => void
  /** Default branch name (shown with label) */
  defaultBranch?: string
  /** Whether the combobox is disabled */
  disabled?: boolean
  /** Mobile layout */
  isMobile?: boolean
}

export function BranchCombobox({
  repo,
  value,
  onChange,
  defaultBranch,
  disabled = false,
  isMobile = false,
}: BranchComboboxProps) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [lastFetchedRepo, setLastFetchedRepo] = useState<string | null>(null)

  // Parse owner and repo name
  const [owner, repoName] = repo.split("/")

  // Fetch branches when popover opens or repo changes
  useEffect(() => {
    if (open && repo && repo !== lastFetchedRepo && !loading) {
      setLoading(true)
      setError(null)
      setBranches([])
      fetchBranches(owner, repoName)
        .then((data) => {
          setBranches(data)
          setLastFetchedRepo(repo)
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false))
    }
  }, [open, repo, owner, repoName, lastFetchedRepo, loading])

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch("")
    }
  }, [open])

  // Filter and sort branches - default branch first
  const filteredBranches = useMemo(() => {
    let filtered = branches
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      filtered = branches.filter((branch) =>
        branch.name.toLowerCase().includes(searchLower)
      )
    }
    // Sort: default branch first, then alphabetically
    return filtered.sort((a, b) => {
      if (a.name === defaultBranch) return -1
      if (b.name === defaultBranch) return 1
      return a.name.localeCompare(b.name)
    })
  }, [branches, search, defaultBranch])

  const handleSelectBranch = (branch: GitHubBranch) => {
    onChange(branch.name)
    setOpen(false)
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
          title={value}
        >
          <GitBranch className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <span className={cn(isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")}>
            {value}
          </span>
          <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search branches..."
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
                <CommandEmpty>No branches found</CommandEmpty>
                <CommandGroup>
                  {filteredBranches.map((branch) => (
                    <CommandItem
                      key={branch.name}
                      value={branch.name}
                      onSelect={() => handleSelectBranch(branch)}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer",
                        value === branch.name && "bg-accent"
                      )}
                    >
                      <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{branch.name}</span>
                      {branch.name === defaultBranch && (
                        <span className="text-xs text-muted-foreground">default</span>
                      )}
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
