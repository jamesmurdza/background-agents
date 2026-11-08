"use client"

import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PATHS } from "@background-agents/common"
import type { Chat } from "@/lib/types"
import { isRealRepo } from "@/lib/types"
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard"
import { materializeAndEnsureSandbox } from "@/lib/sandbox-client"
import type { DraftChatConfig } from "@/lib/storage"

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
  /** Materializes a draft chat into a real one; see lib/hooks/useChatWithSync.ts. */
  materializeDraft: (draftId: string) => Promise<Chat | null>
  /** Draft chat's staged config (repo, pending env vars, etc.), if there is one. */
  draftChatConfig: DraftChatConfig | undefined
  /** Stage/update the draft chat's config (used to park env vars before materializing). */
  updateDraftChatConfig: (updates: Partial<Omit<DraftChatConfig, "id">>) => void
}

export function useSandboxActions({
  currentChat,
  currentChatId,
  chats,
  isDraftChatId,
  onOpenEnvVarsModal,
  materializeDraft,
  draftChatConfig,
  updateDraftChatConfig,
}: UseSandboxActionsOptions) {
  const [envVarsChatEnvVars, setEnvVarsChatEnvVars] = useState<Record<string, string>>({})
  const [envVarsRepoEnvVars, setEnvVarsRepoEnvVars] = useState<Record<string, string>>({})
  // null when Netlify isn't connected, which hides the Deployment tab
  const [envVarsDeployEnvVars, setEnvVarsDeployEnvVars] = useState<Record<string, string> | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  // True while a draft chat's sandbox is being materialized+booted for an
  // action (e.g. VS Code) that needs one but isn't sending a message.
  const [isStartingSandbox, setIsStartingSandbox] = useState(false)
  // Logs on failure (e.g. clipboard permission denied) instead of swallowing it silently.
  const { copy } = useCopyToClipboard()
  const queryClient = useQueryClient()

  // Handler for opening environment variables modal
  const handleOpenEnvVars = useCallback(async () => {
    if (!currentChatId) return
    const isDraft = isDraftChatId(currentChatId)
    if (isDraft && draftChatConfig?.id !== currentChatId) return

    try {
      // Chat-level env vars: a draft has no DB row yet, so read back whatever
      // was staged on its draftChatConfig instead of hitting the API.
      const chatData = isDraft
        ? { environmentVariables: draftChatConfig?.pendingEnvironmentVariables ?? {} }
        : await fetch(`/api/chats/${currentChatId}/env`).then((r) => (r.ok ? r.json() : { environmentVariables: {} }))

      // Repo env vars are keyed by repo name, not chat id, so these work the
      // same for a draft as for a real chat.
      const repoRes = await fetch("/api/user/repo-env")
      const repoData = repoRes.ok ? await repoRes.json() : { repoEnvironmentVariables: {} }

      const repoName = isDraft
        ? (isRealRepo(draftChatConfig?.repo) ? draftChatConfig?.repo : undefined)
        : (isRealRepo(chats.find((c) => c.id === currentChatId)?.repo) ? chats.find((c) => c.id === currentChatId)?.repo : undefined)

      // Deployment (Netlify) env vars need a real, deployed chat — not
      // available for a draft.
      const deployRes = !isDraft && repoName ? await fetch(`/api/chats/${currentChatId}/netlify/env`) : null
      const deployData = deployRes?.ok ? await deployRes.json() : { connected: false }

      setEnvVarsChatEnvVars(chatData.environmentVariables || {})
      setEnvVarsRepoEnvVars((repoName && repoData.repoEnvironmentVariables?.[repoName]) || {})
      setEnvVarsDeployEnvVars(deployData.connected ? deployData.environmentVariables : null)
      onOpenEnvVarsModal()
    } catch (error) {
      console.error("Failed to fetch environment variables:", error)
    }
  }, [currentChatId, isDraftChatId, chats, onOpenEnvVarsModal, draftChatConfig])

  // Handler for saving environment variables
  const handleSaveEnvVars = useCallback(async (
    chatEnvVars: Record<string, string>,
    repoEnvVars: Record<string, string>,
    deployEnvVars?: Record<string, string>
  ) => {
    if (!currentChatId) return
    const isDraft = isDraftChatId(currentChatId)
    if (isDraft && draftChatConfig?.id !== currentChatId) return

    const repoName = isDraft
      ? (isRealRepo(draftChatConfig?.repo) ? draftChatConfig?.repo : undefined)
      : (isRealRepo(chats.find((c) => c.id === currentChatId)?.repo) ? chats.find((c) => c.id === currentChatId)?.repo : undefined)

    if (isDraft) {
      // No DB row to PATCH yet — stage chat-level env vars on the draft
      // config. Applied via materializeAndEnsureSandbox once the draft
      // materializes into a real chat (see lib/sandbox-client.ts). Repo-level
      // vars can be saved immediately below since they're keyed by repo name.
      updateDraftChatConfig({ pendingEnvironmentVariables: chatEnvVars })
    } else {
      // Save chat env vars
      await fetch(`/api/chats/${currentChatId}/env`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentVariables: chatEnvVars }),
      })
    }

    // Save repo env vars if applicable
    if (repoName) {
      await fetch("/api/user/repo-env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoName, environmentVariables: repoEnvVars }),
      })
    }

    // Save the Netlify site's env vars (the server redeploys when they changed).
    // Not available for a draft chat — it has no deployment to redeploy.
    if (deployEnvVars && !isDraft) {
      const res = await fetch(`/api/chats/${currentChatId}/netlify/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentVariables: deployEnvVars }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the deployment variables")
    }
  }, [currentChatId, isDraftChatId, chats, draftChatConfig, updateDraftChatConfig])

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
      void copy(command)
    }
  }, [currentChat?.repo, copy])

  // Copy git checkout command to clipboard
  const handleCopyCheckoutCommand = useCallback(() => {
    if (currentChat?.branch) {
      const command = `git fetch origin ${currentChat.branch} && git checkout ${currentChat.branch}`
      void copy(command)
    }
  }, [currentChat?.branch, copy])

  // Open the current chat's sandbox in VS Code via an SSH remote link.
  const handleOpenInVSCode = useCallback(async () => {
    let sandboxId = currentChat?.sandboxId

    // Draft chat with no sandbox yet: materialize it into a real chat row,
    // then make sure it has a running sandbox, before opening VS Code.
    if (!sandboxId) {
      if (!currentChatId || !isDraftChatId(currentChatId)) return

      setIsStartingSandbox(true)
      try {
        const ensured = await materializeAndEnsureSandbox(
          currentChatId,
          materializeDraft,
          queryClient,
          {
            environmentVariables: draftChatConfig?.pendingEnvironmentVariables,
            clearPending: () => updateDraftChatConfig({ pendingEnvironmentVariables: undefined }),
          },
          undefined,
          {
            servers: draftChatConfig?.pendingMcpServers,
            clearPending: () => updateDraftChatConfig({ pendingMcpServers: undefined }),
          }
        )
        if (!ensured) return
        sandboxId = ensured.sandboxId
      } finally {
        setIsStartingSandbox(false)
      }
    }

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
  }, [currentChat?.sandboxId, currentChatId, isDraftChatId, materializeDraft, draftChatConfig, updateDraftChatConfig, queryClient])

  return {
    isDownloading,
    isStartingSandbox,
    githubBranchUrl,
    envVarsChatEnvVars,
    envVarsRepoEnvVars,
    envVarsDeployEnvVars,
    handleOpenEnvVars,
    handleSaveEnvVars,
    handleDownloadProject,
    handleOpenInGitHub,
    handleCopyCloneCommand,
    handleCopyCheckoutCommand,
    handleOpenInVSCode,
  }
}
