"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { nanoid } from "nanoid"
import { useSession } from "next-auth/react"
import type { AppState, Chat, ChatStatus, Message, QueuedMessage, Settings, SSEUpdateEvent, SSECompleteEvent } from "@/lib/types"
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
  updateMessage,
  updateSettings as updateStoredSettings,
  loadUnseenChatIds,
  saveUnseenChatIds,
  loadAndPruneEmptyChats,
  collectDescendantIds,
} from "@/lib/storage"
import { generateBranchName } from "@/lib/utils"
import { useStreamStore } from "@/lib/stores/stream-store"

// SSE reconnection settings
const SSE_RECONNECT_DELAY = 1000 // 1 second delay before reconnecting
const SSE_MAX_RECONNECT_ATTEMPTS = 10

// Default empty state for SSR
const DEFAULT_STATE: AppState = {
  currentChatId: null,
  chats: [],
  settings: {
    anthropicApiKey: "",
    anthropicAuthToken: "",
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
  const [unseenChatIds, setUnseenChatIds] = useState<Set<string>>(new Set())
  const prevStatuses = useRef<Map<string, ChatStatus>>(new Map())

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    setState(loadAndPruneEmptyChats())
    setUnseenChatIds(loadUnseenChatIds())
    setIsHydrated(true)
  }, [])

  // Persist unseen set
  useEffect(() => {
    if (isHydrated) {
      saveUnseenChatIds(unseenChatIds)
    }
  }, [unseenChatIds, isHydrated])

  // Detect running → non-running transitions and mark unseen
  useEffect(() => {
    if (!isHydrated) return

    // Compute transitions against the ref BEFORE updating it, and update the
    // ref outside the state updater (state updaters are double-invoked in
    // StrictMode, which would corrupt the ref).
    const currentIds = new Set<string>()
    const newlyUnseen: string[] = []
    for (const chat of state.chats) {
      currentIds.add(chat.id)
      const prevStatus = prevStatuses.current.get(chat.id)
      if (
        prevStatus === "running" &&
        chat.status !== "running" &&
        chat.id !== state.currentChatId
      ) {
        newlyUnseen.push(chat.id)
      }
      prevStatuses.current.set(chat.id, chat.status)
    }
    for (const id of Array.from(prevStatuses.current.keys())) {
      if (!currentIds.has(id)) prevStatuses.current.delete(id)
    }

    setUnseenChatIds((prev) => {
      let next = prev
      for (const id of newlyUnseen) {
        if (!prev.has(id)) {
          if (next === prev) next = new Set(prev)
          next.add(id)
        }
      }
      for (const id of prev) {
        if (!currentIds.has(id)) {
          if (next === prev) next = new Set(prev)
          next.delete(id)
        }
      }
      return next
    })
  }, [state.chats, state.currentChatId, isHydrated])

  // Stream state is now managed by useStreamStore (per-chat isolation)
  // This eliminates race conditions from shared refs

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

  const startNewChat = useCallback((
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
  ) => {
    const chat: Chat = {
      id: nanoid(),
      repo,
      baseBranch,
      branch: null,
      sandboxId: null,
      sessionId: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      displayName: null,
      status: initialStatus,
      ...(parentChatId && { parentChatId }),
    }

    const newState = createChat(chat, switchTo)
    setState(newState)

    return chat.id
  }, [])

  const selectChat = useCallback((chatId: string) => {
    // Mark as seen
    setUnseenChatIds((prev) => {
      if (!prev.has(chatId)) return prev
      const next = new Set(prev)
      next.delete(chatId)
      return next
    })

    // Clean up empty chats (no messages) when switching away, except the one we're switching to
    // Keep branched chats (those with parentChatId) even if empty
    const currentId = state.currentChatId
    if (currentId && currentId !== chatId) {
      const currentChat = state.chats.find((c) => c.id === currentId)
      if (currentChat && currentChat.messages.length === 0 && !currentChat.parentChatId) {
        // Delete the empty chat first, then select the new one
        const { state: afterDelete } = deleteStoredChat(currentId)
        const newState = {
          ...afterDelete,
          currentChatId: chatId,
        }
        saveState(newState)
        setState(newState)
        return
      }
    }
    const newState = setCurrentChat(chatId)
    setState(newState)
  }, [state.currentChatId, state.chats])

  // Track which chats are being deleted (for fade animation)
  const [deletingChatIds, setDeletingChatIds] = useState<Set<string>>(new Set())

  const removeChat = useCallback(async (chatId: string) => {
    // Collect the chat + all descendants so branched children cascade.
    const allIds = collectDescendantIds(state.chats, chatId)
    const chatsToDelete = state.chats.filter((c) => allIds.includes(c.id))

    // Stop SSE streams and mark each row as deleting for the fade animation.
    for (const id of allIds) useStreamStore.getState().stopStream(id)
    setDeletingChatIds((prev) => new Set([...prev, ...allIds]))

    // For each chat with a GitHub repo and branch, check if merged and delete remote branch if so.
    // This happens before sandbox deletion since we need the sandbox to execute the delete.
    await Promise.all(
      chatsToDelete
        .filter((c) => c.sandboxId && c.branch && c.repo !== NEW_REPOSITORY)
        .map(async (chat) => {
          try {
            // Parse owner/repo from the repo string
            const [owner, repoName] = chat.repo.split("/")
            if (!owner || !repoName) return

            // Check if branch is merged by comparing with base branch
            const baseBranch = chat.baseBranch || "main"
            const compareRes = await fetch("/api/github/compare", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                owner,
                repo: repoName,
                base: baseBranch,
                head: chat.branch,
              }),
            })

            if (!compareRes.ok) {
              // Branch might not exist on GitHub - that's fine, skip deletion
              return
            }

            const compareData = await compareRes.json()
            const isMerged = compareData.ahead_by === 0

            // Only delete remote branch if it's fully merged
            if (isMerged) {
              await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: chat.sandboxId,
                  // sandbox/create clones into /home/daytona/project
                  repoPath: "/home/daytona/project",
                  action: "delete-remote-branch",
                  currentBranch: chat.branch,
                  repoOwner: owner,
                  repoApiName: repoName,
                }),
              })
            }
          } catch (error) {
            // Don't block chat deletion on remote branch deletion failure
            console.error("Failed to check/delete remote branch:", error)
          }
        })
    )

    // Tear down sandboxes in parallel. Failures don't block chat removal.
    await Promise.all(
      chatsToDelete
        .filter((c) => c.sandboxId)
        .map((c) =>
          fetch("/api/sandbox/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandboxId: c.sandboxId }),
          }).catch((error) => {
            console.error("Failed to delete sandbox:", error)
          })
        )
    )

    const { state: newState } = deleteStoredChat(chatId)
    setState(newState)
    setDeletingChatIds((prev) => {
      const next = new Set(prev)
      for (const id of allIds) next.delete(id)
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

  // Update any chat by ID
  const updateChatById = useCallback((chatId: string, updates: Partial<Chat>) => {
    const newState = updateChat(chatId, updates)
    setState(newState)
  }, [])

  // Rename a chat
  const renameChat = useCallback((chatId: string, newName: string) => {
    const newState = updateChat(chatId, { displayName: newName })
    setState(newState)
  }, [])

  // =============================================================================
  // Messaging
  // =============================================================================

  const sendMessage = useCallback(async (content: string, agent?: string, model?: string, files?: File[], targetChatId?: string) => {
    // Allow specifying a target chat ID (for branch-and-send scenarios)
    // Otherwise fall back to currentChat
    // When targetChatId is provided, read from localStorage directly since
    // React state may not have updated yet after startNewChat
    const targetChat = targetChatId
      ? loadState().chats.find((c) => c.id === targetChatId)
      : currentChat
    if (!targetChat) return

    // Guard: prevent concurrent sends to same chat
    if (useStreamStore.getState().isStreaming(targetChat.id)) {
      console.warn("Already streaming for this chat")
      return
    }

    // For GitHub repos, we need auth. For NEW_REPOSITORY, we don't.
    const isNewRepo = targetChat.repo === NEW_REPOSITORY
    if (!isNewRepo && !session?.accessToken) return

    const chat = targetChat
    // Check if this is the first message (for auto-naming)
    const isFirstMessage = chat.messages.length === 0

    // Get API keys from settings
    const { anthropicApiKey, anthropicAuthToken, openaiApiKey, opencodeApiKey, geminiApiKey } = state.settings

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
    newState = updateChat(chat.id, { lastActiveAt: Date.now(), queuePaused: false })
    setState(newState)

    // 2. If no sandbox, create one (first message)
    let sandboxId = chat.sandboxId
    let branch = chat.branch
    let previewUrlPattern: string | undefined

    if (!sandboxId) {
      // Generate branch name, prefixed so the agent's work is easy to spot in git.
      branch = `agent/${generateBranchName()}`

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
            // NOTE: API keys are NOT passed here - they are passed fresh at
            // execution time via getEnvForModel() to ensure credential changes
            // (like switching from API key to subscription) take effect immediately.
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

    // Always use "project" as the directory name - sandbox/create always uses this
    const repoName = "project"

    // 3. Upload files if any (now that sandbox exists)
    let uploadedFilePaths: string[] | undefined
    if (files && files.length > 0) {
      try {
        const formData = new FormData()
        formData.append("sandboxId", sandboxId!)
        formData.append("repoPath", `/home/daytona/${repoName}`)

        files.forEach((file, index) => {
          formData.append(`file-${index}`, file)
        })

        const uploadResponse = await fetch("/api/sandbox/upload", {
          method: "POST",
          body: formData,
        })

        if (!uploadResponse.ok) {
          const error = await uploadResponse.json().catch(() => ({ error: "Upload failed" }))
          throw new Error(error.message || error.error || "Failed to upload files")
        }

        const uploadResult = await uploadResponse.json()
        uploadedFilePaths = uploadResult.uploadedFiles.map((f: { path: string }) => f.path)

        // Update user message with uploaded file paths
        newState = updateMessage(chat.id, userMessage.id, { uploadedFiles: uploadedFilePaths })
        setState(newState)
      } catch (error) {
        console.error("Failed to upload files:", error)
        // Continue without files - add warning to message
        const errorMessage: Message = {
          id: nanoid(),
          role: "assistant",
          content: `Warning: Failed to upload files: ${error instanceof Error ? error.message : "Unknown error"}. Continuing without files.`,
          timestamp: Date.now(),
        }
        newState = addMessage(chat.id, errorMessage)
        setState(newState)
      }
    }

    // 4. Execute agent
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

    // Build prompt with uploaded files info if any
    let agentPrompt = content
    if (uploadedFilePaths && uploadedFilePaths.length > 0) {
      agentPrompt += "\n\n---\nUploaded files:\n" + uploadedFilePaths.map(p => `- ${p}`).join("\n")
    }

    try {
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          sessionId: chat.sessionId,  // Pass existing session ID for conversation continuity
          prompt: agentPrompt,
          repoName,
          previewUrlPattern: previewUrlPattern || chat.previewUrlPattern,
          agent: selectedAgent,
          model: selectedModel,
          // Pass needsSync to trigger pull on sandbox wake after merge
          needsSync: chat.needsSync,
          // Pass API keys
          ...(anthropicApiKey && { anthropicApiKey }),
          ...(anthropicAuthToken && { anthropicAuthToken }),
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

      // Get the backgroundSessionId from the response
      const executeData = await response.json()
      const { backgroundSessionId, synced } = executeData

      // Clear needsSync if we successfully synced
      const chatUpdates: { backgroundSessionId: string; needsSync?: boolean } = { backgroundSessionId }
      if (synced) {
        chatUpdates.needsSync = false
      }

      // Save backgroundSessionId for recovery after page refresh
      newState = updateChat(chat.id, chatUpdates)
      setState(newState)

      // 4. Start SSE streaming for status
      startStreaming(chat.id, sandboxId!, repoName, backgroundSessionId, previewUrlPattern || chat.previewUrlPattern)

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
  // SSE Streaming
  // =============================================================================

  const startStreaming = useCallback((
    chatId: string,
    sandboxId: string,
    repoName: string,
    backgroundSessionId: string,
    previewUrlPattern?: string
  ) => {
    const streamStore = useStreamStore.getState()

    // Close existing stream for THIS chat only (not all streams)
    // This allows multiple chats to stream concurrently
    if (streamStore.isStreaming(chatId)) {
      streamStore.stopStream(chatId)
    }

    // Initialize stream state in store
    streamStore.startStream(chatId, {
      sandboxId,
      repoName,
      backgroundSessionId,
      previewUrlPattern,
    })

    const connect = (cursor: number = 0) => {
      // Always read fresh state from store (no stale closures)
      const currentStore = useStreamStore.getState()
      const streamState = currentStore.getStream(chatId)
      if (!streamState) return // Stream was stopped

      const params = new URLSearchParams({
        sandboxId,
        repoName,
        backgroundSessionId,
      })
      if (previewUrlPattern) {
        params.set("previewUrlPattern", previewUrlPattern)
      }
      if (cursor > 0) {
        params.set("cursor", cursor.toString())
      }

      const eventSource = new EventSource(`/api/agent/stream?${params}`)

      // Store the EventSource in the store
      currentStore.updateStream(chatId, { eventSource })

      eventSource.addEventListener("update", (event) => {
        try {
          const data: SSEUpdateEvent = JSON.parse(event.data)

          // Always read fresh state from store
          const store = useStreamStore.getState()
          if (!store.isStreaming(chatId)) return // Stream was stopped

          // Update cursor and reset reconnect attempts in store
          store.updateStream(chatId, {
            cursor: data.cursor,
            reconnectAttempts: 0,
          })

          // Accumulate in store (not in closure-captured ref)
          store.appendContent(chatId, data.content)
          store.appendToolCalls(chatId, data.toolCalls)
          store.appendContentBlocks(chatId, data.contentBlocks)

          // Get accumulated and update React state
          const accumulated = store.getAccumulated(chatId)
          if (accumulated) {
            let newState = updateLastMessage(chatId, {
              content: accumulated.content,
              toolCalls: accumulated.toolCalls,
              contentBlocks: accumulated.contentBlocks,
            })
            newState = updateChat(chatId, { lastActiveAt: Date.now() })
            setState(newState)
          }
        } catch (err) {
          console.error("Failed to parse SSE update event:", err)
        }
      })

      eventSource.addEventListener("complete", async (event) => {
        try {
          const data: SSECompleteEvent = JSON.parse(event.data)

          // Clean up stream from store
          useStreamStore.getState().stopStream(chatId)

          // Store sessionId for conversation continuity, clear backgroundSessionId
          const updates: Partial<Chat> = {
            status: data.status === "error" ? "error" : "ready",
            backgroundSessionId: undefined,  // Clear - execution is done
            lastActiveAt: Date.now(),
          }
          if (data.sessionId) {
            updates.sessionId = data.sessionId
          }
          const newState = updateChat(chatId, updates)
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
        } catch (err) {
          console.error("Failed to parse SSE complete event:", err)
        }
      })

      eventSource.addEventListener("heartbeat", (event) => {
        try {
          const data = JSON.parse(event.data)
          // Update cursor in store
          const store = useStreamStore.getState()
          if (store.isStreaming(chatId)) {
            store.updateStream(chatId, {
              cursor: data.cursor,
              reconnectAttempts: 0,
            })
          }
        } catch (err) {
          console.error("Failed to parse SSE heartbeat:", err)
        }
      })

      eventSource.addEventListener("error", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data)
          console.error("SSE error event:", data.error)

          // Clean up and update status
          useStreamStore.getState().stopStream(chatId)

          const newState = updateChat(chatId, {
            status: "error",
            backgroundSessionId: undefined,  // Clear - execution failed
          })
          setState(newState)
        } catch {
          // This is a connection error, not a server-sent error event
          // Attempt reconnection (handled by onerror)
        }
      })

      eventSource.onerror = () => {
        // Connection error - attempt reconnection
        eventSource.close()

        const store = useStreamStore.getState()
        const stream = store.getStream(chatId)
        if (!stream) return // Stream was intentionally stopped

        const attempts = (stream.reconnectAttempts || 0) + 1

        if (attempts <= SSE_MAX_RECONNECT_ATTEMPTS) {
          console.log(`SSE reconnecting for chat ${chatId} (attempt ${attempts})`)
          store.updateStream(chatId, {
            reconnectAttempts: attempts,
            eventSource: null,
          })
          setTimeout(() => {
            // Check if stream still exists before reconnecting
            if (useStreamStore.getState().isStreaming(chatId)) {
              connect(stream.cursor)
            }
          }, SSE_RECONNECT_DELAY)
        } else {
          console.error(`SSE max reconnects reached for chat ${chatId}`)
          store.stopStream(chatId)

          // Update chat status
          const chatState = loadState().chats.find((c) => c.id === chatId)
          if (chatState?.status === "running") {
            const newState = updateChat(chatId, { status: "ready" })
            setState(newState)
          }
        }
      }
    }

    // Start initial connection
    connect()
  }, [])

  const stopAgent = useCallback(() => {
    // Close SSE connection - the agent will continue in background but we won't show updates
    if (currentChat) {
      useStreamStore.getState().stopStream(currentChat.id)
      const hasQueue = (currentChat.queuedMessages?.length ?? 0) > 0
      const newState = updateChat(currentChat.id, {
        status: "ready",
        ...(hasQueue && { queuePaused: true }),
      })
      setState(newState)
    }
  }, [currentChat])

  // Recovery: resume streaming for chats that were running when page was closed
  useEffect(() => {
    if (!isHydrated) return

    const runningChats = state.chats.filter(
      (c) => c.backgroundSessionId && c.sandboxId
    )

    for (const chat of runningChats) {
      // Skip if already streaming (e.g., from a previous recovery attempt)
      if (useStreamStore.getState().isStreaming(chat.id)) continue

      console.log(`Recovering stream for chat ${chat.id}`)
      startStreaming(
        chat.id,
        chat.sandboxId!,
        "project",
        chat.backgroundSessionId!,
        chat.previewUrlPattern
      )
    }
    // Only run once on hydration, not on every state change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated])

  // Cleanup on unmount - stop all streams
  useEffect(() => {
    return () => {
      const store = useStreamStore.getState()
      for (const chatId of store.streams.keys()) {
        store.stopStream(chatId)
      }
    }
  }, [])

  // Add a message to a specific chat (used by git dialogs for system messages)
  const addMessageToChat = useCallback((chatId: string, message: Message) => {
    const newState = addMessage(chatId, message)
    setState(newState)
  }, [])

  // Clear the queuePaused flag so the auto-dispatch effect drains the queue.
  const resumeQueue = useCallback(() => {
    if (!currentChat) return
    if (!currentChat.queuePaused) return
    const newState = updateChat(currentChat.id, { queuePaused: false })
    setState(newState)
  }, [currentChat])

  // Queue a message for the current chat (used when agent is running)
  const enqueueMessage = useCallback((content: string, agent?: string, model?: string) => {
    if (!currentChat) return
    const queued: QueuedMessage = { id: nanoid(), content, agent, model }
    const existing = currentChat.queuedMessages ?? []
    const newState = updateChat(currentChat.id, {
      queuedMessages: [...existing, queued],
      queuePaused: false,
    })
    setState(newState)
  }, [currentChat])

  // Remove a queued message by id from the current chat
  const removeQueuedMessage = useCallback((id: string) => {
    if (!currentChat) return
    const existing = currentChat.queuedMessages ?? []
    const next = existing.filter((m) => m.id !== id)
    const newState = updateChat(currentChat.id, { queuedMessages: next })
    setState(newState)
  }, [currentChat])

  // Dispatch the next queued message for a chat whose agent just finished.
  // Mirrors the execute-and-stream portion of sendMessage, but keyed on chatId.
  const dispatchQueued = useCallback(async (chatId: string) => {
    const fresh = loadState().chats.find((c) => c.id === chatId)
    if (!fresh || !fresh.sandboxId) return
    if (useStreamStore.getState().isStreaming(chatId)) return
    if (!fresh.queuedMessages || fresh.queuedMessages.length === 0) return

    const [next, ...rest] = fresh.queuedMessages
    const { anthropicApiKey, anthropicAuthToken, openaiApiKey, opencodeApiKey, geminiApiKey } = state.settings
    const selectedAgent = next.agent || fresh.agent || state.settings.defaultAgent
    const selectedModel = next.model || fresh.model || state.settings.defaultModel

    // Pop queued, append user message, mark running, insert placeholder assistant
    const userMessage: Message = {
      id: nanoid(),
      role: "user",
      content: next.content,
      timestamp: Date.now(),
    }
    let newState = addMessage(chatId, userMessage)
    newState = updateChat(chatId, {
      queuedMessages: rest,
      lastActiveAt: Date.now(),
      status: "running",
    })
    setState(newState)

    const assistantMessage: Message = {
      id: nanoid(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      toolCalls: [],
    }
    newState = addMessage(chatId, assistantMessage)
    setState(newState)

    try {
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: fresh.sandboxId,
          sessionId: fresh.sessionId,
          prompt: next.content,
          repoName: "project",
          previewUrlPattern: fresh.previewUrlPattern,
          agent: selectedAgent,
          model: selectedModel,
          // Pass needsSync to trigger pull on sandbox wake after merge
          needsSync: fresh.needsSync,
          ...(anthropicApiKey && { anthropicApiKey }),
          ...(anthropicAuthToken && { anthropicAuthToken }),
          ...(openaiApiKey && { openaiApiKey }),
          ...(opencodeApiKey && { opencodeApiKey }),
          ...(geminiApiKey && { geminiApiKey }),
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Execute failed" }))
        throw new Error(error.error || "Failed to execute queued message")
      }
      const data = await response.json()
      const { backgroundSessionId, synced } = data
      // Clear needsSync if we successfully synced
      const chatUpdates: { backgroundSessionId: string; needsSync?: boolean } = { backgroundSessionId }
      if (synced) {
        chatUpdates.needsSync = false
      }
      newState = updateChat(chatId, chatUpdates)
      setState(newState)
      startStreaming(chatId, fresh.sandboxId, "project", backgroundSessionId, fresh.previewUrlPattern)
    } catch (error) {
      console.error("Failed to dispatch queued message:", error)
      newState = updateLastMessage(chatId, {
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
      newState = updateChat(chatId, { status: "error" })
      setState(newState)
    }
  }, [state.settings, startStreaming])

  // Auto-dispatch queued messages when a chat's agent becomes idle
  useEffect(() => {
    if (!isHydrated) return
    const candidate = state.chats.find(
      (c) =>
        c.sandboxId &&
        c.status !== "running" &&
        c.status !== "creating" &&
        !c.queuePaused &&
        c.queuedMessages &&
        c.queuedMessages.length > 0
    )
    if (candidate && !useStreamStore.getState().isStreaming(candidate.id)) {
      dispatchQueued(candidate.id)
    }
  }, [state.chats, isHydrated, dispatchQueued])

  return {
    // State
    chats: state.chats,
    currentChat,
    currentChatId: state.currentChatId,
    settings: state.settings,
    isHydrated,
    deletingChatIds,
    unseenChatIds,

    // Actions
    startNewChat,
    selectChat,
    removeChat,
    renameChat,
    updateChatRepo,
    updateCurrentChat,
    updateChatById,
    sendMessage,
    stopAgent,
    updateSettings,
    addMessage: addMessageToChat,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
  }
}
