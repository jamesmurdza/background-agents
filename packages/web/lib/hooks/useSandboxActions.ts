"use client"

import { useCallback, useState } from "react"
import { PATHS } from "@background-agents/common"
import type { Chat } from "@/lib/types"
import { isRealRepo } from "@/lib/types"

// =============================================================================
// useSandboxActions — actions that operate on the current chat's sandbox/repo:
// environment variables, project download, open-in-VS-Code/GitHub, and clipboard
// helpers for git clone/checkout commands.
// =============================================================================
// Owns the small bits of state these actions need (download in-flight, the
// fetched env-var snapshots) so page.tsx doesn't have to.

interface UseSandboxActionsOptions {
  currentChat: Chat | null
  currentChatId: string | null
  chats: Chat[]
  isDraftChatId: (chatId: string | null) => boolean
  /** Called once env vars have been fetched, to actually open the modal. */
  onOpenEnvVarsModal: () => void
}

export function useSandboxActions({
  currentChat,
  currentChatId,
  chats,
  isDraftChatId,
  onOpenEnvVarsModal,
}: UseSandboxActionsOptions) {
  const [envVarsChatEnvVars, setEnvVarsChatEnvVars] = useState<Record<string, string>>({})
  const [envVarsRepoEnvVars, setEnvVarsRepoEnvVars] = useState<Record<string, string>>({})
  const [isDownloading, setIsDownloading] = useState(false)

  // Handler for opening environment variables modal
  const handleOpenEnvVars = useCallback(async () => {
    if (!currentChatId || isDraftChatId(currentChatId)) return

    try {
      // Fetch chat env vars
      const chatRes = await fetch(`/api/chats/${currentChatId}/env`)
      const chatData = chatRes.ok ? await chatRes.json() : { environmentVariables: {} }

      // Fetch repo env vars
      const repoRes = await fetch("/api/user/repo-env")
      const repoData = repoRes.ok ? await repoRes.json() : { repoEnvironmentVariables: {} }

      const chat = chats.find((c) => c.id === currentChatId)
      const repoName = isRealRepo(chat?.repo) ? chat?.repo : undefined

      setEnvVarsChatEnvVars(chatData.environmentVariables || {})
      setEnvVarsRepoEnvVars(repoName && repoData.repoEnvironmentVariables?.[repoName] || {})
      onOpenEnvVarsModal()
    } catch (error) {
      console.error("Failed to fetch environment variables:", error)
    }
  }, [currentChatId, isDraftChatId, chats, onOpenEnvVarsModal])

  // Handler for saving environment variables
  const handleSaveEnvVars = useCallback(async (chatEnvVars: Record<string, string>, repoEnvVars: Record<string, string>) => {
    if (!currentChatId || isDraftChatId(currentChatId)) return

    const chat = chats.find((c) => c.id === currentChatId)
    const repoName = isRealRepo(chat?.repo) ? chat?.repo : undefined

    // Save chat env vars
    await fetch(`/api/chats/${currentChatId}/env`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentVariables: chatEnvVars }),
    })

    // Save repo env vars if applicable
    if (repoName) {
      await fetch("/api/user/repo-env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoName, environmentVariables: repoEnvVars }),
      })
    }
  }, [currentChatId, isDraftChatId, chats])

  const handleDownloadProject = useCallback(async () => {
    if (!currentChat?.sandboxId || isDownloading) return

    setIsDownloading(true)
    try {
      const response = await fetch("/api/sandbox/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: currentChat.sandboxId }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Download failed" }))
        throw new Error(error.error || "Download failed")
      }

      // Create download link from blob
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${currentChat.displayName || "project"}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[download] Error:", error)
      // Could add a toast/notification here in the future
    } finally {
      setIsDownloading(false)
    }
  }, [currentChat?.sandboxId, currentChat?.displayName, isDownloading])

  // Open the current chat's branch on GitHub (available once the branch is pushed).
  const githubBranchUrl =
    currentChat?.branch && currentChat.sandboxId && isRealRepo(currentChat.repo)
      ? `https://github.com/${currentChat.repo}/tree/${currentChat.branch}`
      : null
  const handleOpenInGitHub = useCallback(() => {
    if (githubBranchUrl) window.open(githubBranchUrl, "_blank", "noopener,noreferrer")
  }, [githubBranchUrl])

  // Copy git clone command to clipboard
  const handleCopyCloneCommand = useCallback(() => {
    if (isRealRepo(currentChat?.repo)) {
      const command = `git clone git@github.com:${currentChat.repo}.git`
      navigator.clipboard.writeText(command)
    }
  }, [currentChat?.repo])

  // Copy git checkout command to clipboard
  const handleCopyCheckoutCommand = useCallback(() => {
    if (currentChat?.branch) {
      const command = `git fetch origin ${currentChat.branch} && git checkout ${currentChat.branch}`
      navigator.clipboard.writeText(command)
    }
  }, [currentChat?.branch])

  // Open the current chat's sandbox in VS Code via an SSH remote link.
  const handleOpenInVSCode = useCallback(async () => {
    const sandboxId = currentChat?.sandboxId
    if (!sandboxId) return
    try {
      const res = await fetch("/api/sandbox/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to open SSH")
      const cmd: string = data.sshCommand
      const userHost = cmd.match(/(\S+@\S+)/)?.[1]
      const port = cmd.match(/-p\s+(\d+)/)?.[1] ?? "22"
      if (!userHost) return
      const host = port !== "22" ? `${userHost}:${port}` : userHost
      window.open(`vscode://vscode-remote/ssh-remote+${host}${PATHS.PROJECT_DIR}`, "_blank")
    } catch (err) {
      console.error("Failed to open in VS Code:", err)
    }
  }, [currentChat?.sandboxId])

  return {
    isDownloading,
    githubBranchUrl,
    envVarsChatEnvVars,
    envVarsRepoEnvVars,
    handleOpenEnvVars,
    handleSaveEnvVars,
    handleDownloadProject,
    handleOpenInGitHub,
    handleCopyCloneCommand,
    handleCopyCheckoutCommand,
    handleOpenInVSCode,
  }
}
