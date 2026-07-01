"use client"

import { FolderGit2, ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"
import { NEW_REPOSITORY } from "@/lib/types"

interface RepoFilterDropdownProps {
  repoFilter: string
  setRepoFilter: (filter: string) => void
  repoDropdownOpen: boolean
  setRepoDropdownOpen: (open: boolean) => void
  uniqueRepos: string[]
  repoCounts: { counts: Record<string, number>; total: number; noRepoCount: number; archivedCount: number }
  getRepoDisplayName: (repo: string) => string
  /** Mobile variant uses larger touch targets and rounded-lg styling. */
  variant: "mobile" | "desktop"
}

/**
 * Repository filter dropdown — surfaces "Active chats" + "Archived chats" +
 * "No repository" + one entry per repo with messages. Used in both desktop
 * and mobile sidebar layouts; the only difference is the touch-target sizing.
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
          {/* Active chats option */}
          <button
            onClick={() => {
              setRepoFilter(ALL_REPOSITORIES)
              setRepoDropdownOpen(false)
            }}
            className={itemClassName}
          >
            <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === ALL_REPOSITORIES ? "opacity-100" : "opacity-0")} />
            <span className="flex-1">Active chats</span>
            <span className="text-muted-foreground">{repoCounts.total}</span>
          </button>

          {/* Archived chats option */}
          <button
            onClick={() => {
              setRepoFilter(ARCHIVED_CHATS)
              setRepoDropdownOpen(false)
            }}
            className={itemClassName}
          >
            <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === ARCHIVED_CHATS ? "opacity-100" : "opacity-0")} />
            <span className="flex-1">Archived chats</span>
            <span className="text-muted-foreground">{repoCounts.archivedCount}</span>
          </button>

          {/* Divider before the repository section */}
          {uniqueRepos.length > 0 && (
            <div className="my-1 border-t border-border" />
          )}

          {/* Repository list — current user's repos first, then others (the
              parent already sorts uniqueRepos this way). */}
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
                <span className="truncate flex-1">{getRepoDisplayName(repo)}</span>
                <span className="text-muted-foreground">{repoCounts.counts[repo] || 0}</span>
              </button>
            ))}

          {/* No repository — sits at the bottom of the repository section. Uses
              an icon-sized spacer in place of the folder icon so its label lines
              up with the repository labels above. */}
          {uniqueRepos.includes(NEW_REPOSITORY) && (
            <button
              onClick={() => {
                setRepoFilter(NO_REPOSITORY)
                setRepoDropdownOpen(false)
              }}
              className={itemClassName}
            >
              <Check className={cn(`${checkSize} flex-shrink-0`, repoFilter === NO_REPOSITORY ? "opacity-100" : "opacity-0")} />
              <span className={cn(iconSize, "flex-shrink-0")} aria-hidden="true" />
              <span className="truncate flex-1">No repository</span>
              <span className="text-muted-foreground">{repoCounts.noRepoCount}</span>
            </button>
          )}
        </div>
      )}
    </>
  )
}
