"use client"

/**
 * Controller for {@link ChatPanel}: owns the composer input, slash-command menu,
 * plan-mode toggle, file-upload state, scroll bookkeeping, and the send /
 * keyboard handlers + derived send-state flags. ChatPanel consumes this and is
 * left as a layout container that wires the returned state into its sub-views.
 */

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react"
import { useModals, useGit } from "@/lib/contexts"
import type { Chat, Settings, CredentialFlags } from "@/lib/types"
import {
  isRealRepo,
  agentModels,
  hasCredentialsForModel,
  resolveAgent,
  resolveModelForAgent,
  agentSupportsPlanMode,
} from "@/lib/types"
import { filterSlashCommandsWithConflict, filterSingleCommand, CREATE_REPO_COMMAND } from "@background-agents/common"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { useFileUpload } from "@/lib/hooks/useFileUpload"

interface UseChatComposerArgs {
  chat: Chat | null
  settings: Settings
  credentialFlags: CredentialFlags
  draft: string
  onDraftChange?: (draft: string) => void
  isMobile: boolean
  isSending: boolean
  isAuthenticated: boolean
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  onEnqueueMessage?: (message: string, agent?: string, model?: string) => void
  onResumeQueue?: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onSlashCommand?: (command: SlashCommandType) => void
}

export function useChatComposer({
  chat,
  settings,
  credentialFlags,
  draft,
  onDraftChange,
  isMobile,
  isSending,
  isAuthenticated,
  onSendMessage,
  onEnqueueMessage,
  onResumeQueue,
  onUpdateChat,
  onSlashCommand,
}: UseChatComposerArgs) {
  // Get modal and git state from contexts
  const modals = useModals()
  const git = useGit()
  // Use draft prop as input value (controlled component pattern for per-chat drafts)
  const input = draft
  const setInput = useCallback((value: string) => {
    onDraftChange?.(value)
  }, [onDraftChange])
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false)
  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  // Plan mode state - persisted to database via onUpdateChat, with local state for immediate UI updates
  const [planModeEnabled, setPlanModeEnabledLocal] = useState(chat?.planModeEnabled ?? false)
  // Sync local state when chat changes (switching between chats) or when chat.planModeEnabled changes
  useEffect(() => {
    setPlanModeEnabledLocal(chat?.planModeEnabled ?? false)
  }, [chat?.id, chat?.planModeEnabled])
  // Wrapper that updates both local state and persists to database
  const setPlanModeEnabled = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    // Calculate the new value outside the state setter to avoid calling onUpdateChat during render
    const newValue = typeof value === 'function' ? value(planModeEnabled) : value
    setPlanModeEnabledLocal(newValue)
    // Call onUpdateChat after the state update, not inside the setter callback
    onUpdateChat?.({ planModeEnabled: newValue })
  }, [onUpdateChat, planModeEnabled])
  // Current agent (from chat, the user's preference, or the default). Used for
  // the plan-mode check here and the model resolution below.
  const currentAgent = resolveAgent(chat?.agent, settings.defaultAgent)
  // Reset plan mode when switching to an agent that doesn't support it
  useEffect(() => {
    if (planModeEnabled && !agentSupportsPlanMode[currentAgent]) {
      setPlanModeEnabled(false)
    }
  }, [currentAgent, planModeEnabled, setPlanModeEnabled])
  // File upload state - using custom hook
  const fileUpload = useFileUpload({ onRequireSignIn: isAuthenticated ? undefined : () => modals.setSignInModalOpen(true) })
  const {
    pendingFiles,
    previewFile,
    fileContents,
    fileInputRef,
    removeFile,
    clearFiles,
    setPreviewFile,
  } = fileUpload

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prevChatIdRef = useRef<string | null>(null)

  const focusPrompt = useCallback((moveCursorToEnd: boolean = false) => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.focus()

    if (moveCursorToEnd) {
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    }
  }, [])

  // Resolve the model for the current agent (honoring the saved default).
  const currentModel = chat?.model ?? resolveModelForAgent(currentAgent, credentialFlags, settings.defaultModel)

  // Check if the selected model has required credentials
  const availableModels = agentModels[currentAgent] ?? []
  const selectedModelConfig = availableModels.find(m => m.value === currentModel)
  const hasRequiredCredentials = selectedModelConfig
    ? hasCredentialsForModel(selectedModelConfig, credentialFlags, currentAgent)
    : true

  // Conflict state (from context)
  const rebaseConflict = git.rebaseConflict
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)
  const isMergeConflict = rebaseConflict?.inMerge ?? false

  // Treat the chat as running while it has (non-paused) queued messages too,
  // so the UI doesn't flicker between ready and running as the queue drains.
  const hasQueued = (chat?.queuedMessages?.length ?? 0) > 0
  const isPaused = !!(chat?.queuePaused && hasQueued)
  const isRunning = chat?.status === "running" || (hasQueued && !chat?.queuePaused)
  // Include isSending for instant feedback before server responds
  const isCreating = chat?.status === "creating" || isSending
  const hasContent = input.trim() || pendingFiles.length > 0
  // When the agent is running, text-only messages are queued for later dispatch.
  const canQueue = !!onEnqueueMessage && !!input.trim() && pendingFiles.length === 0
  // Paused queue: always show the send button (either to enqueue a new prompt
  // at the end or to resume draining with nothing typed).
  const canSend =
    (hasContent && !isRunning && !isCreating && !isPaused) ||
    (isRunning && canQueue) ||
    isPaused

  // Track if user has scrolled up from bottom
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    setUserHasScrolledUp(!isAtBottom)
  }

  // Auto-scroll to bottom when chat changes or content grows during streaming.
  useLayoutEffect(() => {
    const chatChanged = chat?.id !== prevChatIdRef.current
    prevChatIdRef.current = chat?.id ?? null

    if (chatChanged || !userHasScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
    }
  }, [chat?.id, chat?.messages, userHasScrolledUp])

  // Focus prompt when switching chats or when the welcome view transitions to
  // the messages view (which remounts the textarea in a different DOM location).
  useEffect(() => {
    if (isMobile) return
    const t = window.setTimeout(() => {
      focusPrompt(true)
    }, 0)
    return () => window.clearTimeout(t)
  }, [chat?.id, isCreating, isMobile, focusPrompt])

  // Auto-resize textarea - use requestAnimationFrame to batch DOM reads/writes
  // and avoid layout thrashing on every keystroke
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Use rAF to batch DOM operations and avoid synchronous layout
    const rafId = requestAnimationFrame(() => {
      // Store current scroll position to avoid scroll jumps
      const scrollTop = textarea.scrollTop
      textarea.style.height = "auto"
      const maxHeight = isMobile ? 120 : 200
      textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px"
      textarea.scrollTop = scrollTop
    })

    return () => cancelAnimationFrame(rafId)
  }, [input, isMobile])

  // Update slash menu visibility based on input.
  const hasLinkedRepo = isRealRepo(chat?.repo)
  useEffect(() => {
    if (input.startsWith("/")) {
      setSlashMenuOpen(true)
    } else {
      setSlashMenuOpen(false)
      setSlashSelectedIndex(0)
    }
  }, [input])

  // Get filtered commands for keyboard navigation. When there's no linked repo,
  // the slash menu swaps in a single "Create repository" entry.
  const filteredCommands = useMemo(() => {
    if (hasLinkedRepo) return filterSlashCommandsWithConflict(input, inConflict)
    return filterSingleCommand(input, CREATE_REPO_COMMAND)
  }, [input, hasLinkedRepo, inConflict])

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback((command: SlashCommandType) => {
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
    setInput("")
    if (command === "repo") {
      // Open the create repo modal directly
      modals.setRepoCreateOpen(true)
      return
    }
    if (command === "abort") {
      git.handleAbortConflict?.()
      return
    }
    onSlashCommand?.(command)
  }, [onSlashCommand, modals, git, setInput])

  const handleSend = () => {
    if (!canSend) return
    // Don't send if credentials are missing - the UI shows a warning instead
    if (!hasRequiredCredentials) return

    // Reset scroll state so we snap to bottom when sending
    setUserHasScrolledUp(false)

    // If the agent is running, queue the message instead of sending.
    if (isRunning && onEnqueueMessage) {
      onEnqueueMessage(input.trim(), currentAgent, currentModel)
      setInput("")
      textareaRef.current?.focus()
      return
    }

    // Paused queue: typed text goes to the end of the queue and unpauses it;
    // with nothing typed, just resume draining.
    if (isPaused) {
      if (input.trim() && onEnqueueMessage) {
        onEnqueueMessage(input.trim(), currentAgent, currentModel)
        setInput("")
      } else {
        onResumeQueue?.()
      }
      textareaRef.current?.focus()
      return
    }

    // Pass files to sendMessage - upload will happen after sandbox is ready
    const files = pendingFiles.length > 0 ? pendingFiles.map(pf => pf.file) : undefined
    onSendMessage(input.trim(), currentAgent, currentModel, files, planModeEnabled || undefined)
    setInput("")
    clearFiles()
    textareaRef.current?.focus()
  }

  // Branch-and-send: create a sibling chat off the current branch and dispatch
  // the message to it in the background. Triggered by Cmd/Alt/Ctrl+Enter or by
  // holding one of those modifiers while clicking the send button.
  const handleBranchSend = () => {
    if (git.canBranch && input.trim()) {
      git.handleBranchWithMessage(input.trim(), currentAgent, currentModel)
      setInput("")
      clearFiles()
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle slash command menu navigation
    if (slashMenuOpen && filteredCommands.length > 0 && onSlashCommand) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSlashSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          return
        case "ArrowUp":
          e.preventDefault()
          setSlashSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          return
        case "Enter":
          e.preventDefault()
          if (filteredCommands[slashSelectedIndex]) {
            handleSlashCommandSelect(filteredCommands[slashSelectedIndex].name as SlashCommandType)
          }
          return
        case "Tab":
          e.preventDefault()
          if (filteredCommands[slashSelectedIndex]) {
            handleSlashCommandSelect(filteredCommands[slashSelectedIndex].name as SlashCommandType)
          }
          return
        case "Escape":
          e.preventDefault()
          setSlashMenuOpen(false)
          setSlashSelectedIndex(0)
          setInput("")
          return
      }
    }

    // Shift+Enter to insert newline (let browser handle it)
    if (e.key === "Enter" && e.shiftKey) {
      return
    }

    // Option/Alt+Enter, Command/Meta+Enter, or Ctrl+Enter to branch and send
    if (e.key === "Enter" && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleBranchSend()
      return
    }

    // Normal enter to send
    if (e.key === "Enter") {
      e.preventDefault()
      handleSend()
    }
  }

  return {
    // contexts (re-exposed so the view doesn't re-read them)
    modals,
    git,
    // input + composer
    input,
    setInput,
    textareaRef,
    handleSend,
    handleBranchSend,
    canBranch: git.canBranch,
    handleKeyDown,
    // scroll
    messagesEndRef,
    messagesContainerRef,
    userHasScrolledUp,
    setUserHasScrolledUp,
    handleScroll,
    // slash menu
    slashMenuOpen,
    setSlashMenuOpen,
    slashSelectedIndex,
    setSlashSelectedIndex,
    filteredCommands,
    handleSlashCommandSelect,
    hasLinkedRepo,
    // plan mode
    planModeEnabled,
    setPlanModeEnabled,
    // agent/model
    currentAgent,
    currentModel,
    // conflict
    rebaseConflict,
    inConflict,
    isMergeConflict,
    // derived flags
    hasQueued,
    isRunning,
    isCreating,
    canSend,
    canQueue,
    // file upload (pass-through)
    fileUpload,
    previewFile,
    fileContents,
    removeFile,
    setPreviewFile,
  }
}
