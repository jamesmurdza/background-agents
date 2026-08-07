"use client"

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react"
import { useSession } from "next-auth/react"
import {
  Github,
  Lock,
  Globe,
  ChevronDown,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchAllRepos } from "@/lib/github"
import { basename } from "@/lib/format"
import { signInWithGitHub } from "@/lib/auth-utils"
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
  /** If true, clicking the button opens the create modal directly instead of showing the dropdown */
  createOnly?: boolean
}

export function RepoCombobox({
  value,
  onChange,
  onRequestCreate,
  disabled = false,
  isMobile = false,
  showLabel = false,
  createOnly = false,
}: RepoComboboxProps) {
  const { status } = useSession()
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const loadingRef = useRef(false)

  const loadRepos = useCallback(async () => {
    if (status !== "authenticated" || loadingRef.current) return

    loadingRef.current = true
    setLoading(true)
    setLoadingMore(false)
    setError(null)

    let isFirstPage = true
    try {
      await fetchAllRepos((repos, isComplete) => {
        setRepos(repos)
        if (isFirstPage) {
          setLoading(false)
          isFirstPage = false
          if (!isComplete) {
            setLoadingMore(true)
          }
        }
        if (isComplete) {
          setLoadingMore(false)
        }
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load repositories"
      )
    } finally {
      loadingRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [status])

  // Fetch once when an authenticated user opens an empty picker. Keep errors
  // visible until the user retries instead of immediately starting the same
  // failing request again.
  useEffect(() => {
    if (open && status === "authenticated" && repos.length === 0 && !error) {
      void loadRepos()
    }
  }, [open, status, repos.length, error, loadRepos])

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch("")
      setError(null)
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
  const displayLabel = value ? basename(value) : "Repository"

  const handleSelectRepo = (repo: GitHubRepo) => {
    onChange(repo.full_name, repo.default_branch)
    setOpen(false)
  }

  const handleCreateClick = () => {
    setOpen(false)
    onRequestCreate?.()
  }

  // If createOnly mode, render a simple button that opens the create modal directly
  if (createOnly) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRequestCreate?.()}
        className={cn(
          "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        title="Create new repository"
      >
        <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        <span className={cn(
          showLabel ? "inline" : (isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")
        )}>
          {displayLabel}
        </span>
        <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
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
          {status === "authenticated" && (
            <CommandInput
              placeholder="Search repositories..."
              value={search}
              onValueChange={setSearch}
            />
          )}
          <CommandList>
            {status === "loading" && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {status === "unauthenticated" && (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Sign in with GitHub to load your repositories.
                </p>
                <button
                  type="button"
                  onClick={() => signInWithGitHub()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Github className="h-4 w-4" />
                  Sign in with GitHub
                </button>
              </div>
            )}
            {status === "authenticated" && loading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {status === "authenticated" && error && (
              <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadRepos()}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            )}
            {status === "authenticated" && !loading && !error && (
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
                <CommandEmpty>{loadingMore ? "Loading repositories..." : "No repositories found"}</CommandEmpty>
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
                  {/* Loading indicator for background pagination */}
                  {loadingMore && filteredRepos.length > 0 && (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading more...
                    </div>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
