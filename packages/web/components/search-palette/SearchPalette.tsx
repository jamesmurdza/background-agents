"use client"

import { useMemo } from "react"
import { GitBranch, FolderGit2, Clock, MessageSquare } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import { addRecentItem, getRecentItems, type RecentItem } from "@background-agents/common"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import { NEW_REPOSITORY } from "@/lib/types"
import type { PaletteChat } from "./types"

interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: GitHubRepo[]
  currentRepo: string | null // "owner/repo"
  branches: GitHubBranch[]
  chats: PaletteChat[]
  /** Repositories shown in the sidebar's repository selector ("owner/repo" or NEW_REPOSITORY). */
  sidebarRepos: string[]
  onSelectRepo: (repo: GitHubRepo) => void
  onSelectBranch: (repo: GitHubRepo, branch: GitHubBranch) => void
  onSelectChat: (chatId: string) => void
  /** Select a repository in the sidebar (sets the repo filter) — does not create a chat. */
  onFilterRepo: (repo: string) => void
}

export function SearchPalette({
  open,
  onOpenChange,
  repos,
  currentRepo,
  branches,
  chats,
  sidebarRepos,
  onSelectRepo,
  onSelectBranch,
  onSelectChat,
  onFilterRepo,
}: SearchPaletteProps) {
  const recentItems = useMemo(() => getRecentItems(), [open])

  const currentRepoData = useMemo(
    () => repos.find((r) => `${r.owner.login}/${r.name}` === currentRepo) ?? null,
    [repos, currentRepo]
  )

  const handleSelectBranch = (branch: GitHubBranch) => {
    if (!currentRepoData) return
    addRecentItem({
      id: `branch:${currentRepoData.owner.login}/${currentRepoData.name}:${branch.name}`,
      type: "branch",
      repoOwner: currentRepoData.owner.login,
      repoName: currentRepoData.name,
      branchName: branch.name,
    })
    onSelectBranch(currentRepoData, branch)
    onOpenChange(false)
  }

  const handleSelectChat = (chat: PaletteChat) => {
    onSelectChat(chat.id)
    onOpenChange(false)
  }

  // Selecting a repository filters the sidebar to it (mirrors the sidebar's
  // repository selector); it does NOT create a new chat.
  const handleFilterRepo = (repo: string) => {
    onFilterRepo(repo)
    onOpenChange(false)
  }

  const handleSelectRecent = (item: RecentItem) => {
    if (item.type === "repo") {
      const repo = repos.find(
        (r) => r.owner.login === item.repoOwner && r.name === item.repoName
      )
      if (repo) {
        onSelectRepo(repo)
      }
    } else {
      const repo = repos.find(
        (r) => r.owner.login === item.repoOwner && r.name === item.repoName
      )
      if (repo) {
        const branch = branches.find((b) => b.name === item.branchName)
        if (branch) {
          onSelectBranch(repo, branch)
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
      description="Search for chats, repos, and branches"
    >
      <CommandInput placeholder="Search chats, repos, and branches..." />
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

        {/* Chats */}
        {chats.length > 0 && (
          <CommandGroup heading="Chats">
            {chats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={`chat:${chat.displayName ?? chat.id}:${chat.repo}`}
                onSelect={() => handleSelectChat(chat)}
              >
                <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>
                  {chat.displayName ?? "Untitled Chat"}
                  {chat.repo !== NEW_REPOSITORY && (
                    <span className="text-muted-foreground text-xs ml-2">({chat.repo})</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Repositories — same set as the sidebar's repository selector.
            Selecting one filters the sidebar to that repo (no new chat). */}
        {sidebarRepos.length > 0 && (
          <CommandGroup heading="Repositories">
            {sidebarRepos.map((repo) => (
              <CommandItem
                key={repo}
                value={`repo:${repo}`}
                onSelect={() => handleFilterRepo(repo)}
              >
                <FolderGit2 className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{repo === NEW_REPOSITORY ? "No repository" : repo}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Branches from current repo */}
        {currentRepoData && branches.length > 0 && (
          <CommandGroup heading={`Branches (${currentRepoData.owner.login}/${currentRepoData.name})`}>
            {branches.map((branch) => (
              <CommandItem
                key={branch.name}
                value={`branch:${currentRepoData.owner.login}/${currentRepoData.name}/${branch.name}`}
                onSelect={() => handleSelectBranch(branch)}
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
