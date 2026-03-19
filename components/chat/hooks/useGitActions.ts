import { useState, useCallback, useEffect } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, PATHS } from "@/lib/constants"
import { useGitDialogs } from "@/components/git/hooks/useGitDialogs"

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
  onToggleGitHistory: () => void
}

/**
 * Handles git operations: PR creation, merge, rebase, reset, tag
 * Uses useGitDialogs for merge/rebase/tag operations
 */
export function useGitActions({
  branch,
  repoName,
  repoFullName,
  repoOwner,
  onUpdateBranch,
  onAddMessage,
  onToggleGitHistory,
}: UseGitActionsOptions) {
  // Use shared git dialogs hook for merge/rebase/tag
  const gitDialogs = useGitDialogs({
    branch,
    repoName,
    repoOwner,
    repoFullName,
    onAddMessage,
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

  const addSystemMessage = useCallback((content: string) => {
    // System messages go to the current branch (user-initiated git actions)
    onAddMessage(branch.id, {
      id: generateId(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }, [branch.id, onAddMessage])

  // Check for changes between branch and base branch
  const checkForChanges = useCallback(async () => {
    if (!branch.sandboxId) {
      setHasChanges(false)
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
          base: branch.baseBranch,
          head: branch.name,
        }),
      })
      const data = await res.json()
      // Check if there's any actual diff content
      const hasDiff = data.diff && data.diff.trim() !== "" && data.diff !== "No differences found."
      setHasChanges(hasDiff)
    } catch {
      setHasChanges(false)
    }
  }, [branch.sandboxId, branch.baseBranch, branch.name, repoFullName])

  // Check for changes periodically and when branch status changes
  useEffect(() => {
    // Initial check
    checkForChanges()

    // Poll for changes every 30 seconds
    const interval = setInterval(checkForChanges, 30000)
    return () => clearInterval(interval)
  }, [checkForChanges, branch.status])

  const handleSandboxToggle = useCallback(async () => {
    if (!branch.sandboxId || sandboxToggleLoading) return
    const isStopped = branch.status === BRANCH_STATUS.STOPPED
    setSandboxToggleLoading(true)
    try {
      const res = await fetch("/api/sandbox/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          action: isStopped ? "start" : "stop",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch(branch.id, { status: isStopped ? BRANCH_STATUS.IDLE : BRANCH_STATUS.STOPPED })
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
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          repo,
          head: branch.name,
          base: branch.baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch(branch.id, { prUrl: data.url })
      window.open(data.url, "_blank")
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
      handleCreatePR()
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
    if (action === "tag") {
      gitDialogs.setTagOpen(true)
      return
    }
    if (action === "diff") {
      setDiffModalOpen(true)
      return
    }
  }, [onToggleGitHistory, handleCreatePR, gitDialogs])

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

    // Actions
    handleSandboxToggle,
    handleCreatePR,
    handleHeaderAction,
    handleVSCodeClick,
    handleRsyncClick,
    addSystemMessage,
  }
}
