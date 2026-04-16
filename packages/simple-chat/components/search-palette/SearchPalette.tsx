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
import { addRecentItem, getRecentItems, type RecentItem } from "@upstream/common"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"

interface Chat {
  id: string
  displayName: string | null
  repo: string
}

interface SearchPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: GitHubRepo[]
  currentRepo: string | null // "owner/repo"
  branches: GitHubBranch[]
  chats: Chat[]
  onSelectRepo: (repo: GitHubRepo) => void
  onSelectBranch: (repo: GitHubRepo, branch: GitHubBranch) => void
  onSelectChat: (chatId: string) => void
}

export function SearchPalette({
  open,
  onOpenChange,
  repos,
  currentRepo,
  branches,
  chats,
  onSelectRepo,
  onSelectBranch,
  onSelectChat,
}: SearchPaletteProps) {
  const recentItems = useMemo(() => getRecentItems(), [open])

  const currentRepoData = useMemo(
    () => repos.find((r) => `${r.owner.login}/${r.name}` === currentRepo) ?? null,
    [repos, currentRepo]
  )

  const handleSelectRepo = (repo: GitHubRepo) => {
    addRecentItem({
      id: `repo:${repo.owner.login}/${repo.name}`,
      type: "repo",
      repoOwner: repo.owner.login,
      repoName: repo.name,
    })
    onSelectRepo(repo)
    onOpenChange(false)
  }

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

  const handleSelectChat = (chat: Chat) => {
    onSelectChat(chat.id)
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
                  <span className="text-muted-foreground text-xs ml-2">({chat.repo})</span>
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
              value={`repo:${repo.owner.login}/${repo.name}`}
              onSelect={() => handleSelectRepo(repo)}
            >
              <FolderGit2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>
                {repo.owner.login}/{repo.name}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

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
