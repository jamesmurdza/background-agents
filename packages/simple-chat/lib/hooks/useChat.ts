"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { nanoid } from "nanoid"
import { useSession } from "next-auth/react"
import type { AppState, Chat, Message, Settings, AgentStatusResponse } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import {
  loadState,
  saveState,
  createChat,
  updateChat,
  deleteChat as deleteStoredChat,
  setCurrentChat,
  addMessage,
  updateLastMessage,
  updateSettings as updateStoredSettings,
} from "@/lib/storage"
import { generateBranchName } from "@/lib/utils"

const POLL_INTERVAL = 1000 // 1 second

// Default empty state for SSR
const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: {
    anthropicApiKey: "",
    openaiApiKey: "",
    opencodeApiKey: "",
    geminiApiKey: "",
    defaultAgent: "opencode",
    defaultModel: "opencode/big-pickle",
    theme: "system",
  },
}

export function useChat() {
  const { data: session } = useSession()

  // Start with empty state to avoid hydration mismatch
  const [state, setState] = useState<AppState>(DEFAULT_STATE)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    setState(loadState())
    setIsHydrated(true)
  }, [])

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const isPollingRef = useRef(false)

  // Sync state to localStorage (only after hydration)
  useEffect(() => {
    if (isHydrated) {
      saveState(state)
    }
  }, [state, isHydrated])

  // Get current chat
  const currentChat = state.chats.find((c) => c.id === state.currentChatId) ?? null

  // =============================================================================
  // Chat Operations
  // =============================================================================

  const startNewChat = useCallback((repo: string = NEW_REPOSITORY, baseBranch: string = "main") => {
    const chat: Chat = {
      id: nanoid(),
      repo,
      baseBranch,
      branch: null,
      sandboxId: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      displayName: null,
      status: "pending",
    }

    const newState = createChat(chat)
    setState(newState)

    return chat.id
  }, [])

  const selectChat = useCallback((chatId: string) => {
    const newState = setCurrentChat(chatId)
    setState(newState)
  }, [])

  // Track which chats are being deleted (for fade animation)
  const [deletingChatIds, setDeletingChatIds] = useState<Set<string>>(new Set())

  const removeChat = useCallback(async (chatId: string) => {
    // Get the chat before deleting to access sandboxId
    const chat = state.chats.find((c) => c.id === chatId)

    // Stop polling if this is the current chat
    if (pollingRef.current && state.currentChatId === chatId) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
      isPollingRef.current = false
    }

    // Mark as deleting (grays out the item)
    setDeletingChatIds((prev) => new Set([...prev, chatId]))

    // Delete sandbox if it exists
    if (chat?.sandboxId) {
      try {
        await fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId: chat.sandboxId }),
        })
      } catch (error) {
        console.error("Failed to delete sandbox:", error)
        // Continue with chat deletion even if sandbox deletion fails
      }
    }

    // Delete the chat immediately after sandbox deletion completes
    const newState = deleteStoredChat(chatId)
    setState(newState)
    setDeletingChatIds((prev) => {
      const next = new Set(prev)
      next.delete(chatId)
      return next
    })
  }, [state.chats, state.currentChatId])

  // Update repo for a chat (only allowed before first message)
  const updateChatRepo = useCallback((chatId: string, repo: string, baseBranch: string) => {
    const chat = state.chats.find((c) => c.id === chatId)
    if (!chat) return

    // Can select/change existing repo only before first message and sandbox creation
    const canSelectRepo = chat.messages.length === 0 && !chat.sandboxId
    // Can assign a new repo (after creating it) if chat was started without a repo
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY

    if (!canSelectRepo && !canAssignNewRepo) {
      // Can't change repo in other cases
      return
    }

    const newState = updateChat(chatId, { repo, baseBranch })
    setState(newState)
  }, [state.chats])

  // =============================================================================
  // Settings
  // =============================================================================

  const updateSettings = useCallback((settings: Partial<Settings>) => {
    const newState = updateStoredSettings(settings)
    setState(newState)
  }, [])

  // Update the current chat
  const updateCurrentChat = useCallback((updates: Partial<Chat>) => {
    if (!state.currentChatId) return
    const newState = updateChat(state.currentChatId, updates)
    setState(newState)
  }, [state.currentChatId])

  // =============================================================================
  // Messaging
  // =============================================================================

  const sendMessage = useCallback(async (content: string, agent?: string, model?: string) => {
    if (!currentChat) return

    // For GitHub repos, we need auth. For NEW_REPOSITORY, we don't.
    const isNewRepo = currentChat.repo === NEW_REPOSITORY
    if (!isNewRepo && !session?.accessToken) return

    const chat = currentChat
    // Check if this is the first message (for auto-naming)
    const isFirstMessage = chat.messages.length === 0

    // Get API keys from settings
    const { anthropicApiKey, openaiApiKey, opencodeApiKey, geminiApiKey } = state.settings

    // Use provided agent/model or fall back to chat/settings defaults
    const selectedAgent = agent || chat.agent || state.settings.defaultAgent
    const selectedModel = model || chat.model || state.settings.defaultModel

    // 1. Add user message
    const userMessage: Message = {
      id: nanoid(),
      role: "user",
      content,
      timestamp: Date.now(),
    }

    let newState = addMessage(chat.id, userMessage)
    setState(newState)

    // 2. If no sandbox, create one (first message)
    let sandboxId = chat.sandboxId
    let branch = chat.branch
    let previewUrlPattern: string | undefined

    if (!sandboxId) {
      // Generate branch name
      branch = generateBranchName()

      // Update chat status
      newState = updateChat(chat.id, { status: "creating", branch })
      setState(newState)

      try {
        const response = await fetch("/api/sandbox/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo: chat.repo,
            baseBranch: chat.baseBranch || "main",
            newBranch: branch,
            // Pass API key if configured (optional for OpenCode)
            ...(anthropicApiKey && { anthropicApiKey }),
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || "Failed to create sandbox")
        }

        const data = await response.json()
        sandboxId = data.sandboxId
        previewUrlPattern = data.previewUrlPattern

        newState = updateChat(chat.id, {
          sandboxId,
          branch,
          previewUrlPattern,
          status: "ready",
        })
        setState(newState)
      } catch (error) {
        console.error("Failed to create sandbox:", error)

        // Add error message
        const errorMessage: Message = {
          id: nanoid(),
          role: "assistant",
          content: `Failed to create sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
          timestamp: Date.now(),
        }
        newState = addMessage(chat.id, errorMessage)
        newState = updateChat(chat.id, { status: "error" })
        setState(newState)
        return
      }
    }

    // 3. Execute agent
    newState = updateChat(chat.id, { status: "running" })
    setState(newState)

    // Add placeholder assistant message
    const assistantMessage: Message = {
      id: nanoid(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: [],
    }
    newState = addMessage(chat.id, assistantMessage)
    setState(newState)

    const repoName = isNewRepo ? "project" : chat.repo.split("/")[1]

    try {
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          prompt: content,
          repoName,
          previewUrlPattern: previewUrlPattern || chat.previewUrlPattern,
          agent: selectedAgent,
          model: selectedModel,
          // Pass API keys
          ...(anthropicApiKey && { anthropicApiKey }),
          ...(openaiApiKey && { openaiApiKey }),
          ...(opencodeApiKey && { opencodeApiKey }),
          ...(geminiApiKey && { geminiApiKey }),
        }),
      })

      if (!response.ok) {
        const error = await response.json()

        // Handle sandbox not found - need to recreate
        if (error.error === "SANDBOX_NOT_FOUND") {
          newState = updateChat(chat.id, { sandboxId: null, status: "pending" })
          setState(newState)
          // Retry by calling sendMessage again
          return sendMessage(content)
        }

        throw new Error(error.error || "Failed to execute agent")
      }

      // 4. Start polling for status
      startPolling(chat.id, sandboxId!, repoName, previewUrlPattern || chat.previewUrlPattern)

      // 5. Generate chat name from first message (fire-and-forget)
      if (isFirstMessage) {
        fetch("/api/chat/suggest-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: content }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.name) {
              const updated = updateChat(chat.id, { displayName: data.name })
              setState(updated)
            }
          })
          .catch((err) => {
            console.error("Failed to generate chat name:", err)
          })
      }
    } catch (error) {
      console.error("Failed to execute agent:", error)

      newState = updateLastMessage(chat.id, {
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
      newState = updateChat(chat.id, { status: "error" })
      setState(newState)
    }
  }, [currentChat, session?.accessToken, state.settings])

  // =============================================================================
  // Polling
  // =============================================================================

  const startPolling = useCallback((
    chatId: string,
    sandboxId: string,
    repoName: string,
    previewUrlPattern?: string
  ) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    isPollingRef.current = true

    const poll = async () => {
      if (!isPollingRef.current) return

      try {
        const params = new URLSearchParams({
          sandboxId,
          repoName,
        })
        if (previewUrlPattern) {
          params.set("previewUrlPattern", previewUrlPattern)
        }

        const response = await fetch(`/api/agent/status?${params}`)

        if (!response.ok) {
          // Handle 404: session no longer exists (server restarted or session expired)
          if (response.status === 404) {
            console.warn("Agent session no longer exists, stopping polling")
            isPollingRef.current = false
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
            // Update chat status to ready (not error, since work may have completed)
            const currentState = loadState()
            const existingChat = currentState.chats.find((c) => c.id === chatId)
            if (existingChat && existingChat.status === "running") {
              const newState = updateChat(chatId, { status: "ready" })
              setState(newState)
            }
            return
          }
          throw new Error("Failed to poll status")
        }

        const data: AgentStatusResponse = await response.json()

        // Update message - the API now returns accumulated content
        let newState = updateLastMessage(chatId, {
          content: data.content,
          toolCalls: data.toolCalls,
          contentBlocks: data.contentBlocks,
        })
        setState(newState)

        // Handle completion
        if (data.status === "completed" || data.status === "error") {
          isPollingRef.current = false
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }

          newState = updateChat(chatId, { status: data.status === "error" ? "error" : "ready" })
          setState(newState)

          // Auto-push on completion (only for GitHub repos, not NEW_REPOSITORY)
          if (data.status === "completed") {
            const chat = loadState().chats.find((c) => c.id === chatId)
            if (chat?.branch && chat.repo !== NEW_REPOSITORY) {
              try {
                await fetch("/api/git/push", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sandboxId,
                    repoName,
                    branch: chat.branch,
                  }),
                })
              } catch (error) {
                console.error("Failed to auto-push:", error)
              }
            }
          }
        }
      } catch (error) {
        console.error("Polling error:", error)
      }
    }

    // Initial poll
    poll()

    // Set up interval
    pollingRef.current = setInterval(poll, POLL_INTERVAL)
  }, [])

  const stopAgent = useCallback(() => {
    // Just stop polling - the agent will continue in background but we won't show updates
    isPollingRef.current = false
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    if (currentChat) {
      const newState = updateChat(currentChat.id, { status: "ready" })
      setState(newState)
    }
  }, [currentChat])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  return {
    // State
    chats: state.chats,
    currentChat,
    currentChatId: state.currentChatId,
    settings: state.settings,
    isHydrated,
    deletingChatIds,

    // Actions
    startNewChat,
    selectChat,
    removeChat,
    updateChatRepo,
    updateCurrentChat,
    sendMessage,
    stopAgent,
    updateSettings,
  }
}
