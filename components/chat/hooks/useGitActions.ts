import { useState, useCallback } from "react"
import type { Branch, Message } from "@/lib/types"
import { generateId } from "@/lib/store"
import { BRANCH_STATUS, PATHS } from "@/lib/constants"

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
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [branchPickerModal, setBranchPickerModal] = useState<{ action: "merge" | "rebase" | "diff" } | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [tagNameInput, setTagNameInput] = useState("")
  const [diffModalOpen, setDiffModalOpen] = useState(false)
  const [commitDiffHash, setCommitDiffHash] = useState<string | null>(null)
  const [commitDiffMessage, setCommitDiffMessage] = useState<string | null>(null)
  const [rsyncModalOpen, setRsyncModalOpen] = useState(false)
  const [rsyncCommand, setRsyncCommand] = useState("")
  const [rsyncCopied, setRsyncCopied] = useState(false)
  const [sandboxToggleLoading, setSandboxToggleLoading] = useState(false)

  const addSystemMessage = useCallback((content: string) => {
    // System messages go to the current branch (user-initiated git actions)
    onAddMessage(branch.id, {
      id: generateId(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }, [branch.id, onAddMessage])

  const fetchBranches = useCallback(async () => {
    setBranchesLoading(true)
    try {
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`
      )
      const data = await res.json()
      const branches = (data.branches || []).filter((b: string) => b !== branch.name)
      setRemoteBranches(branches)
      setSelectedBranch(branches.includes(branch.baseBranch) ? branch.baseBranch : branches[0] || "")
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }, [repoOwner, repoName, branch.name, branch.baseBranch])

  const openBranchPicker = useCallback((action: "merge" | "rebase" | "diff") => {
    setBranchPickerModal({ action })
    setSelectedBranch("")
    fetchBranches()
  }, [fetchBranches])

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
  }, [branch.sandboxId, branch.status, sandboxToggleLoading, onUpdateBranch])

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
  }, [branch.prUrl, branch.name, branch.baseBranch, repoFullName, onUpdateBranch])

  const handleMerge = useCallback(async () => {
    if (!selectedBranch) return
    setBranchPickerModal(null)
    setActionLoading("merge")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "merge",
          targetBranch: selectedBranch,
          currentBranch: branch.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Merged **${branch.name}** into **${selectedBranch}** and pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }, [selectedBranch, branch.sandboxId, branch.name, repoName, addSystemMessage])

  const handleRebase = useCallback(async () => {
    if (!selectedBranch) return
    const [owner, repo] = repoFullName.split("/")
    setBranchPickerModal(null)
    setActionLoading("rebase")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "rebase",
          targetBranch: selectedBranch,
          currentBranch: branch.name,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Rebased **${branch.name}** onto **${selectedBranch}** and force-pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }, [selectedBranch, branch.sandboxId, branch.name, repoFullName, repoName, addSystemMessage])

  const handleTag = useCallback(async () => {
    const name = tagNameInput.trim()
    if (!name) return
    const [owner, repo] = repoFullName.split("/")
    setTagPopoverOpen(false)
    setTagNameInput("")
    setActionLoading("tag")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "tag",
          tagName: name,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Tag **${name}** created and pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Tag failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }, [tagNameInput, branch.sandboxId, repoFullName, repoName, addSystemMessage])

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
      openBranchPicker("merge")
      return
    }
    if (action === "rebase") {
      openBranchPicker("rebase")
      return
    }
    if (action === "tag") {
      setTagPopoverOpen(true)
      return
    }
    if (action === "diff") {
      setDiffModalOpen(true)
      return
    }
  }, [onToggleGitHistory, handleCreatePR, openBranchPicker])

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
    // Loading states
    actionLoading,
    branchesLoading,
    sandboxToggleLoading,

    // Branch picker
    branchPickerModal,
    setBranchPickerModal,
    remoteBranches,
    selectedBranch,
    setSelectedBranch,

    // Tag
    tagPopoverOpen,
    setTagPopoverOpen,
    tagNameInput,
    setTagNameInput,

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

    // Actions
    handleSandboxToggle,
    handleCreatePR,
    handleMerge,
    handleRebase,
    handleTag,
    handleHeaderAction,
    handleVSCodeClick,
    handleRsyncClick,
    addSystemMessage,
  }
}
