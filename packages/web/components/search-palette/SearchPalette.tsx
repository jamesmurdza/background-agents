"use client"

import { useMemo } from "react"
import { GitBranch, FolderGit2, Clock } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import { fuzzyMatch, addRecentItem, getRecentItems, type RecentItem } from "@upstream/common"
import type { Repo } from "@/lib/shared/types"

interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: Repo[]
  activeRepoId: string | null
  onSelectRepo: (repoId: string) => void
  onSelectBranch: (repoId: string, branchId: string) => void
}

export function SearchPalette({
  open,
  onOpenChange,
  repos,
  activeRepoId,
  onSelectRepo,
  onSelectBranch,
}: SearchPaletteProps) {
  const recentItems = useMemo(() => getRecentItems(), [open])

  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? null,
    [repos, activeRepoId]
  )

  const handleSelectRepo = (repo: Repo) => {
    addRecentItem({
      id: `repo:${repo.id}`,
      type: "repo",
      repoOwner: repo.owner,
      repoName: repo.name,
    })
    onSelectRepo(repo.id)
    onOpenChange(false)
  }

  const handleSelectBranch = (repo: Repo, branchId: string, branchName: string) => {
    addRecentItem({
      id: `branch:${repo.id}:${branchId}`,
      type: "branch",
      repoOwner: repo.owner,
      repoName: repo.name,
      branchName,
    })
    onSelectBranch(repo.id, branchId)
    onOpenChange(false)
  }

  const handleSelectRecent = (item: RecentItem) => {
    if (item.type === "repo") {
      const repo = repos.find(
        (r) => r.owner === item.repoOwner && r.name === item.repoName
      )
      if (repo) {
        onSelectRepo(repo.id)
      }
    } else {
      const repo = repos.find(
        (r) => r.owner === item.repoOwner && r.name === item.repoName
      )
      if (repo) {
        const branch = repo.branches.find((b) => b.name === item.branchName)
        if (branch) {
          onSelectBranch(repo.id, branch.id)
        }
      }
    }
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search for repos and branches"
    >
      <CommandInput placeholder="Search repos and branches..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Recent items */}
        {recentItems.length > 0 && (
          <CommandGroup heading="Recent">
            {recentItems.slice(0, 5).map((item) => (
              <CommandItem
                key={item.id}
                value={`recent:${item.repoOwner}/${item.repoName}${item.branchName ? `/${item.branchName}` : ""}`}
                onSelect={() => handleSelectRecent(item)}
              >
                <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  {item.repoOwner}/{item.repoName}
                  {item.branchName && (
                    <span className="text-muted-foreground"> / {item.branchName}</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Repositories */}
        <CommandGroup heading="Repositories">
          {repos.map((repo) => (
            <CommandItem
              key={repo.id}
              value={`repo:${repo.owner}/${repo.name}`}
              onSelect={() => handleSelectRepo(repo)}
            >
              <FolderGit2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>
                {repo.owner}/{repo.name}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Branches from active repo */}
        {activeRepo && activeRepo.branches.length > 0 && (
          <CommandGroup heading={`Branches (${activeRepo.owner}/${activeRepo.name})`}>
            {activeRepo.branches.map((branch) => (
              <CommandItem
                key={branch.id}
                value={`branch:${activeRepo.owner}/${activeRepo.name}/${branch.name}`}
                onSelect={() => handleSelectBranch(activeRepo, branch.id, branch.name)}
              >
                <GitBranch className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{branch.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
