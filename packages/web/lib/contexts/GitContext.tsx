"use client"

import { createContext, useContext, ReactNode } from "react"
import type { UseGitDialogsResult } from "@/components/modals/git-dialogs"

// =============================================================================
// GitContext - Provides git dialog state and operations
// =============================================================================

export interface GitContextValue extends UseGitDialogsResult {
  // Additional git-related state can be added here
  canBranch: boolean
  handleBranchChat: () => void
  handleBranchWithMessage: (message: string, agent: string, model: string) => Promise<void>
  handleBranchQueuedMessage: (id: string, message: string, agent?: string, model?: string) => Promise<void>
}

const GitContext = createContext<GitContextValue | null>(null)

export function GitProvider({ children, value }: { children: ReactNode; value: GitContextValue }) {
  return <GitContext.Provider value={value}>{children}</GitContext.Provider>
}

export function useGit(): GitContextValue {
  const context = useContext(GitContext)
  if (!context) {
    throw new Error("useGit must be used within a GitProvider")
  }
  return context
}
