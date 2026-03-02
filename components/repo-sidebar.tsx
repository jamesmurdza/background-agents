"use client"

import { cn } from "@/lib/utils"
import type { Repo } from "@/lib/mock-data"
import { Plus, Settings } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface RepoSidebarProps {
  repos: Repo[]
  activeRepoId: string
  onSelectRepo: (repoId: string) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
}

export function RepoSidebar({ repos, activeRepoId, onSelectRepo, onOpenSettings, onOpenAddRepo }: RepoSidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="mb-2 flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold">
              Ah
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">AgentHub</TooltipContent>
        </Tooltip>

        <div className="mx-auto h-px w-8 bg-border" />

        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          const hasRunning = repo.branches.some((b) => b.status === "running")
          return (
            <Tooltip key={repo.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectRepo(repo.id)}
                  className={cn(
                    "relative flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg font-mono text-xs font-semibold transition-all",
                    isActive
                      ? "bg-accent text-foreground ring-2 ring-primary"
                      : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
                  </svg>
                  {hasRunning && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {repo.owner}/{repo.name}
              </TooltipContent>
            </Tooltip>
          )
        })}

        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenAddRepo}
                className="flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add repository</TooltipContent>
          </Tooltip>

          <div className="mx-auto h-px w-8 bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenSettings}
                className="flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
