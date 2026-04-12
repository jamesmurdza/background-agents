import { useState, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/shared/types"
import { generateId } from "@/lib/shared/store"
import { ASSISTANT_SOURCE, PATHS } from "@/lib/shared/constants"
import { useGitDialogs } from "@/components/git/hooks/useGitDialogs"
import { toggleSandbox, createPR } from "@/lib/git/git-actions"

// Export the return type for use in sub-components
export type UseGitActionsReturn = ReturnType<typeof useGitActions>

interface UseGitActionsOptions {
  branch: Branch
  repoName: string
  repoFullName: string
  repoOwner: string
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  /** Add message to a specific branch - branchId param ensures correct branch */
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void | Promise<void>
  onToggleGitHistory: () => void
  defaultSquashOnMerge?: boolean
}

/**
 * Handles git operations: PR creation, merge, rebase, reset
 * Uses useGitDialogs for merge/rebase operations
 */
export function useGitActions({
  branch,
  repoName,
  repoFullName,
  repoOwner,
  onUpdateBranch,
  onAddMessage,
  onUpdateMessage,
  onToggleGitHistory,
  defaultSquashOnMerge,
}: UseGitActionsOptions) {
  // Use shared git dialogs hook for merge/rebase
  const gitDialogs = useGitDialogs({
    branch,
    repoName,
    repoOwner,
    repoFullName,
    onAddMessage,
    onUpdateMessage,
    defaultSquashOnMerge,
  })

  // Desktop-specific state
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [commitDiffHash, setCommitDiffHash] = useState<string | null>(null)
  const [commitDiffMessage, setCommitDiffMessage] = useState<string | null>(null)
  const [rsyncModalOpen, setRsyncModalOpen] = useState(false)
  const [rsyncCommand, setRsyncCommand] = useState("")
  const [rsyncCopied, setRsyncCopied] = useState(false)
  const [sandboxToggleLoading, setSandboxToggleLoading] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [diffStats, setDiffStats] = useState<{ additions: number; deletions: number } | null>(null)

  const addSystemMessage = useCallback((content: string) => {
    // System messages go to the current branch (user-initiated git actions)
    onAddMessage(branch.id, {
      id: generateId(),
      role: "assistant",
      assistantSource: ASSISTANT_SOURCE.SYSTEM,
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }, [branch.id, onAddMessage])

  // Check for changes between branch and base branch
  const checkForChanges = useCallback(async () => {
    if (!branch.sandboxId) {
      setHasChanges(false)
      setDiffStats(null)
      return
    }
    const [owner, repo] = repoFullName.split("/")
    try {
      const res = await fetch("/api/github/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          base: branch.startCommit || branch.baseBranch,
          head: branch.name,
        }),
      })
      // Handle non-200 responses gracefully (e.g., branch not found, no commits)
      if (!res.ok) {
        setHasChanges(false)
        setDiffStats(null)
        return
      }
      const data = await res.json()
      // Check if there's any actual diff content
      const hasDiff = data.diff && data.diff.trim() !== "" && data.diff !== "No differences found."
      setHasChanges(hasDiff)

      // Parse diff to extract line stats
      if (hasDiff && data.diff) {
        const lines = data.diff.split("\n")
        let additions = 0
        let deletions = 0
        for (const line of lines) {
          // Count lines starting with + or - but not diff headers (+++, ---)
          if (line.startsWith("+") && !line.startsWith("+++")) {
            additions++
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++
          }
        }
        setDiffStats({ additions, deletions })
      } else {
        setDiffStats(null)
      }
    } catch {
      setHasChanges(false)
      setDiffStats(null)
    }
  }, [branch.sandboxId, branch.baseBranch, branch.name, repoFullName])

  // Check for changes when branch status changes (e.g., execution completes)
  // No need to poll continuously - just check when relevant state changes
  useEffect(() => {
    checkForChanges()
  }, [checkForChanges, branch.status])

  const handleSandboxToggle = useCallback(async () => {
    if (!branch.sandboxId || sandboxToggleLoading) return
    setSandboxToggleLoading(true)
    try {
      const result = await toggleSandbox(branch.sandboxId, branch.status)
      onUpdateBranch(branch.id, { status: result.newStatus })
    } catch {
      // ignore
    } finally {
      setSandboxToggleLoading(false)
    }
  }, [branch.sandboxId, branch.status, branch.id, sandboxToggleLoading, onUpdateBranch])

  const handleCreatePR = useCallback(async () => {
    if (branch.prUrl) {
      window.open(branch.prUrl, "_blank")
      return
    }
    const [owner, repo] = repoFullName.split("/")
    setActionLoading("create-pr")
    try {
      const result = await createPR(owner, repo, branch.name, branch.baseBranch)
      onUpdateBranch(branch.id, { prUrl: result.url })
      window.open(result.url, "_blank")
    } catch {
      // Silently fail
    } finally {
      setActionLoading(null)
    }
  }, [branch.prUrl, branch.name, branch.baseBranch, branch.id, repoFullName, onUpdateBranch])

  const handleHeaderAction = useCallback((action: string) => {
    if (action === "log") {
      onToggleGitHistory()
      return
    }
    if (action === "create-pr") {
      // If there's already a PR, just open it
      if (branch.prUrl) {
        window.open(branch.prUrl, "_blank")
        return
      }
      // Otherwise show the PR dialog for branch selection
      gitDialogs.setPROpen(true)
      return
    }
    if (action === "merge") {
      gitDialogs.setMergeOpen(true)
      return
    }
    if (action === "rebase") {
      gitDialogs.setRebaseOpen(true)
      return
    }
    if (action === "diff") {
      setDiffModalOpen(true)
      return
    }
  }, [onToggleGitHistory, branch.prUrl, gitDialogs])

  const handleVSCodeClick = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: branch.sandboxId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const cmd = data.sshCommand as string
      const userHostMatch = cmd.match(/(\S+@\S+)/)
      const portMatch = cmd.match(/-p\s+(\d+)/)
      if (userHostMatch) {
        const userHost = userHostMatch[1]
        const port = portMatch ? portMatch[1] : "22"
        const host = port !== "22" ? `${userHost}:${port}` : userHost
        const remotePath = `${PATHS.SANDBOX_HOME}/${repoName}`
        window.open(`vscode://vscode-remote/ssh-remote+${host}${remotePath}`, "_blank")
      }
    } catch {}
  }, [branch.sandboxId, repoName])

  const handleRsyncClick = useCallback(async () => {
    try {
      const res = await fetch("/api/sandbox/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: branch.sandboxId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const cmd = data.sshCommand as string
      const userHostMatch = cmd.match(/(\S+@\S+)/)
      const portMatch = cmd.match(/-p\s+(\d+)/)
      if (userHostMatch) {
        const userHost = userHostMatch[1]
        const port = portMatch ? portMatch[1] : "22"
        const [owner, repo] = repoFullName.split("/")
        const safeBranch = branch.name.replace(/[^a-zA-Z0-9._-]/g, "-")
        const localDir = `./${owner}-${repo}-${safeBranch}`
        const rsyncCmd = `mkdir -p ${localDir} && \\\nwhile true; do \\\n  rsync -avz --filter=':- .gitignore' -e 'ssh -p ${port}' \\\n    ${userHost}:${PATHS.SANDBOX_HOME}/${repoName}/ \\\n    ${localDir}/; \\\n  sleep 2; \\\ndone`
        setRsyncCommand(rsyncCmd)
        setRsyncCopied(false)
        setRsyncModalOpen(true)
      }
    } catch {}
  }, [branch.sandboxId, branch.name, repoFullName, repoName])

  return {
    // Git dialogs (shared between mobile and desktop)
    gitDialogs,

    // Desktop-specific loading states
    actionLoading,
    sandboxToggleLoading,

    // Diff
    diffModalOpen,
    setDiffModalOpen,
    commitDiffHash,
    setCommitDiffHash,
    commitDiffMessage,
    setCommitDiffMessage,

    // Rsync
    rsyncModalOpen,
    setRsyncModalOpen,
    rsyncCommand,
    rsyncCopied,
    setRsyncCopied,

    // Changes detection
    hasChanges,
    diffStats,

    // Actions
    handleSandboxToggle,
    handleCreatePR,
    handleHeaderAction,
    handleVSCodeClick,
    handleRsyncClick,
    addSystemMessage,
  }
}
