"use client"

import { FolderGit2, ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { ALL_REPOSITORIES, NO_REPOSITORY } from "@/lib/contexts"
import { NEW_REPOSITORY } from "@/lib/types"

interface RepoFilterDropdownProps {
  repoFilter: string
  setRepoFilter: (filter: string) => void
  repoDropdownOpen: boolean
  setRepoDropdownOpen: (open: boolean) => void
  uniqueRepos: string[]
  repoCounts: { counts: Record<string, number>; total: number; noRepoCount: number }
  getRepoDisplayName: (repo: string) => string
  /** Mobile variant uses larger touch targets and rounded-lg styling. */
  variant: "mobile" | "desktop"
}

/**
 * Repository filter dropdown — surfaces "All chats" + "No repository" +
 * one entry per repo with messages. Used in both desktop and mobile
 * sidebar layouts; the only difference is the touch-target sizing.
 *
 * Counts come from the parent (computed once over the full chats list),
 * so each row shows how many chats would survive the filter.
 */
export function RepoFilterDropdown({
  repoFilter,
  setRepoFilter,
  repoDropdownOpen,
  setRepoDropdownOpen,
  uniqueRepos,
  repoCounts,
  getRepoDisplayName,
  variant,
}: RepoFilterDropdownProps) {
  const isMobile = variant === "mobile"

  // Styling differences between mobile and desktop
  const buttonClassName = isMobile
    ? "flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent/50 active:bg-accent transition-colors"
    : "flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/50 transition-colors cursor-pointer"

  const dropdownClassName = isMobile
    ? "absolute left-3 right-3 top-full mt-1 rounded-lg border border-border bg-popover shadow-lg py-1 z-50 max-h-64 overflow-y-auto"
    : "absolute left-2 right-2 top-full mt-1 rounded-md border border-border bg-popover shadow-lg py-1 z-50 max-h-64 overflow-y-auto"

  const itemClassName = isMobile
    ? "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
    : "flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left cursor-pointer"

  const chevronSize = isMobile ? "h-4 w-4" : "h-3.5 w-3.5"
  const checkSize = isMobile ? "h-4 w-4" : "h-3.5 w-3.5"
  const iconSize = isMobile ? "h-4 w-4" : "h-3.5 w-3.5"

  return (
    <>
      <button
        onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
        className={buttonClassName}
      >
        <span className="truncate">{getRepoDisplayName(repoFilter)}</span>
        <ChevronDown className={cn(`${chevronSize} flex-shrink-0 transition-transform`, repoDropdownOpen && "rotate-180")} />
      </button>

      {repoDropdownOpen && (
        <div className={dropdownClassName}>
          {/* All repositories option */}
          <button
            onClick={() => {
              setRepoFilter(ALL_REPOSITORIES)
              setRepoDropdownOpen(false)
            }}
            className={itemClassName}
          >
            <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === ALL_REPOSITORIES ? "opacity-100" : "opacity-0")} />
            <span className="flex-1">All chats</span>
            <span className="text-muted-foreground">{repoCounts.total}</span>
          </button>

          {/* No repository option */}
          {uniqueRepos.includes(NEW_REPOSITORY) && (
            <button
              onClick={() => {
                setRepoFilter(NO_REPOSITORY)
                setRepoDropdownOpen(false)
              }}
              className={itemClassName}
            >
              <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === NO_REPOSITORY ? "opacity-100" : "opacity-0")} />
              <span className="flex-1">No repository</span>
              <span className="text-muted-foreground">{repoCounts.noRepoCount}</span>
            </button>
          )}

          {/* Divider if there are actual repos */}
          {uniqueRepos.some(r => r !== NEW_REPOSITORY) && (
            <div className="my-1 border-t border-border" />
          )}

          {/* Repository list */}
          {uniqueRepos
            .filter(repo => repo !== NEW_REPOSITORY)
            .map((repo) => (
              <button
                key={repo}
                onClick={() => {
                  setRepoFilter(repo)
                  setRepoDropdownOpen(false)
                }}
                className={itemClassName}
              >
                <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === repo ? "opacity-100" : "opacity-0")} />
                <FolderGit2 className={cn(`${iconSize} flex-shrink-0 text-muted-foreground`)} />
                <span className="truncate flex-1">{repo}</span>
                <span className="text-muted-foreground">{repoCounts.counts[repo] || 0}</span>
              </button>
            ))}
        </div>
      )}
    </>
  )
}
