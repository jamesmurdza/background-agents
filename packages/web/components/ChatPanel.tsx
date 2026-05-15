"use client"

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react"
import { Github, HelpCircle, Plus, X, Command } from "lucide-react"
import { ErrorBanner, FilePreviewModal, ChatHeader, MobileConflictBar, ChatInput } from "./chat"
import { cn } from "@/lib/utils"
import { useModals, useGit } from "@/lib/contexts"
import type { Chat, Settings, Agent, CredentialFlags } from "@/lib/types"
import { NEW_REPOSITORY, agentModels, hasCredentialsForModel, getDefaultAgent, getDefaultModelForAgent } from "@/lib/types"
import { filterSlashCommandsWithConflict } from "@upstream/common"
import { MessageBubble } from "./MessageBubble"
import type { SlashCommandType } from "./SlashCommandMenu"
import { useFileUpload } from "@/lib/hooks/useFileUpload"

interface ChatPanelProps {
  chat: Chat | null
  settings: Settings
  credentialFlags: CredentialFlags
  showClaudeLimitDialog: () => void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  onEnqueueMessage?: (message: string, agent?: string, model?: string) => void
  onRemoveQueuedMessage?: (id: string) => void
  onResumeQueue?: () => void
  onStopAgent: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onSlashCommand?: (command: SlashCommandType) => void
  onOpenFile?: (filePath: string) => void
  /** Callback to open the environment variables modal */
  onOpenEnvVars?: () => void
  isMobile?: boolean
  /** Whether messages are currently being loaded for this chat */
  isLoadingMessages?: boolean
  /** Current draft text for this chat */
  draft?: string
  /** Callback when draft text changes */
  onDraftChange?: (draft: string) => void
  /** Whether a message send is in progress (for instant UI feedback) */
  isSending?: boolean
  /** Callback to open the command palette */
  onOpenCommandPalette?: () => void
  /** Callback to open a plan in the preview pane */
  onOpenPlan?: (messageId: string) => void
  /** Whether the user is authenticated */
  isAuthenticated?: boolean
  /** Whether rapid fire mode is enabled */
  rapidFireMode?: boolean
  /** Timestamp of last rapid fire task creation (0 = no notification) */
  rapidFireNotification?: number
}

export function ChatPanel({ chat, settings, credentialFlags, showClaudeLimitDialog, onSendMessage, onEnqueueMessage, onRemoveQueuedMessage, onResumeQueue, onStopAgent, onUpdateChat, onSlashCommand, onOpenFile, onOpenEnvVars, isMobile = false, isLoadingMessages = false, draft = "", onDraftChange, isSending = false, onOpenCommandPalette, onOpenPlan, isAuthenticated = false, rapidFireMode = false, rapidFireNotification = 0 }: ChatPanelProps) {
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
  // Plan mode state
  const [planModeEnabled, setPlanModeEnabled] = useState(false)
  // File upload state - using custom hook
  const {
    pendingFiles,
    isDraggingOver,
    previewFile,
    fileContents,
    fileError,
    fileInputRef,
    addFiles,
    removeFile,
    clearFiles,
    clearError: clearFileError,
    setPreviewFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    getFileTypeForFile,
    getFilePreviewUrl,
    supportedExtensions,
  } = useFileUpload({ onRequireSignIn: isAuthenticated ? undefined : () => modals.setSignInModalOpen(true) })

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

  // Get current agent/model (from chat, the user's preference, or auto-resolved
  // from credential flags). Uses ?? so we don't trip over the empty string.
  const currentAgent = (chat?.agent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
  const currentModel = chat?.model ?? settings.defaultModel ?? getDefaultModelForAgent(currentAgent, credentialFlags)

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
  const hasLinkedRepo = !!(chat?.repo && chat.repo !== NEW_REPOSITORY)
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
    const filter = input.startsWith("/") ? input.slice(1).toLowerCase() : input.toLowerCase()
    const repoCmd = { name: "repo", description: "Create repository", icon: "FolderGit2" }
    if (!filter || repoCmd.name.startsWith(filter)) return [repoCmd]
    return []
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
  }, [onSlashCommand, modals, git])

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
      if (git.canBranch && input.trim()) {
        git.handleBranchWithMessage(input.trim(), currentAgent, currentModel)
        setInput("")
        clearFiles()
        textareaRef.current?.focus()
      }
      return
    }

    // Normal enter to send
    if (e.key === "Enter") {
      e.preventDefault()
      handleSend()
    }
  }

  // No chat selected - show a skeleton while the first chat is being created.
  if (!chat) {
    return (
      <div className="flex-1 flex flex-col bg-background min-h-0 animate-pulse">
        {!isMobile && (
          <div className="pt-3 pl-[1.625rem] pr-4">
            <div className="h-6 w-40 rounded bg-muted" />
          </div>
        )}
        <div className="flex-1" />
        <div className={cn(
          "w-full mx-auto",
          isMobile ? "max-w-full px-3 pb-3" : "max-w-[52rem] px-4 pb-4"
        )}>
          <div className={cn(
            "flex flex-col border border-border bg-card shadow-sm",
            isMobile ? "rounded-xl" : "rounded-2xl"
          )}>
            <div className={cn(isMobile ? "px-3 py-3" : "px-4 py-3")}>
              <div className="h-5 w-1/3 rounded bg-muted" />
            </div>
            <div className={cn(
              "flex items-center gap-2 border-t border-border",
              isMobile ? "px-3 py-2" : "px-4 py-2"
            )}>
              <div className="h-6 w-20 rounded bg-muted" />
              <div className="h-6 w-24 rounded bg-muted" />
              <div className="flex-1" />
              <div className={cn("rounded-md bg-muted", isMobile ? "h-9 w-9" : "h-7 w-7")} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isNewRepo = chat.repo === NEW_REPOSITORY
  // Can select an existing repo only before first message and sandbox creation
  const canSelectExistingRepo = chat.messages.length === 0 && !chat.sandboxId
  // Can create a new repo anytime if still on NEW_REPOSITORY
  const canCreateRepo = isNewRepo
  // Show the repo button if either action is available
  const showRepoButton = canSelectExistingRepo || canCreateRepo
  // Only show welcome screen if no messages AND not loading messages AND not a child chat
  const isNewChat = chat.messages.length === 0 && !chat.parentChatId && !isLoadingMessages

  // Rapid fire notification
  const showRapidFireNotification = rapidFireMode && rapidFireNotification && rapidFireNotification > 0

  // Chat input component
  const chatInput = (
    <ChatInput
      chat={chat}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      onStop={onStopAgent}
      onKeyDown={handleKeyDown}
      textareaRef={textareaRef}
      // File upload
      pendingFiles={pendingFiles}
      fileContents={fileContents}
      fileError={fileError}
      fileInputRef={fileInputRef}
      isDraggingOver={isDraggingOver}
      supportedExtensions={supportedExtensions}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onAddFiles={addFiles}
      onRemoveFile={removeFile}
      onClearFileError={clearFileError}
      onPreviewFile={setPreviewFile}
      getFileTypeForFile={getFileTypeForFile}
      getFilePreviewUrl={getFilePreviewUrl}
      // Slash commands
      slashMenuOpen={slashMenuOpen}
      slashSelectedIndex={slashSelectedIndex}
      onSlashSelect={handleSlashCommandSelect}
      onSlashClose={() => {
        setSlashMenuOpen(false)
        setSlashSelectedIndex(0)
      }}
      onSlashSelectedIndexChange={setSlashSelectedIndex}
      hasLinkedRepo={hasLinkedRepo}
      inConflict={inConflict}
      hasSlashCommands={!!onSlashCommand}
      // State flags
      isRunning={isRunning}
      isCreating={isCreating}
      isNewChat={isNewChat}
      canSend={canSend}
      canQueue={canQueue}
      // Repo/branch
      showRepoButton={showRepoButton}
      isNewRepo={isNewRepo}
      canSelectExistingRepo={canSelectExistingRepo}
      onUpdateChat={onUpdateChat}
      defaultBranch={chat?.baseBranch}
      // Agent/model
      credentialFlags={credentialFlags}
      currentAgent={currentAgent}
      currentModel={currentModel}
      showClaudeLimitDialog={showClaudeLimitDialog}
      // Plan mode
      planModeEnabled={planModeEnabled}
      onPlanModeToggle={() => setPlanModeEnabled((v) => !v)}
      onSetPlanMode={setPlanModeEnabled}
      // Mobile
      isMobile={isMobile}
    />
  )

  // Loading messages skeleton - check BEFORE isNewChat to prevent flash
  if (isLoadingMessages) {
    return (
      <div className="flex-1 flex flex-col bg-background min-h-0 animate-pulse">
        {/* Header skeleton */}
        {!isMobile && (
          <div className="pt-3 pl-[1.625rem] pr-4">
            <div className="h-6 w-48 rounded bg-muted" />
          </div>
        )}
        {/* Empty messages area */}
        <div className="flex-1" />
        {/* Input skeleton */}
        <div className={cn(
          "w-full mx-auto",
          isMobile ? "max-w-full px-3 pb-3" : "max-w-[52rem] px-4 pb-4"
        )}>
          <div className={cn(
            "flex flex-col border border-border bg-card shadow-sm",
            isMobile ? "rounded-xl" : "rounded-2xl"
          )}>
            <div className={cn(isMobile ? "px-3 py-3" : "px-4 py-3")}>
              <div className="h-5 w-1/4 rounded bg-muted" />
            </div>
            <div className={cn(
              "flex items-center gap-2 border-t border-border",
              isMobile ? "px-3 py-2" : "px-4 py-2"
            )}>
              <div className="h-6 w-20 rounded bg-muted" />
              <div className="h-6 w-24 rounded bg-muted" />
              <div className="flex-1" />
              <div className={cn("rounded-md bg-muted", isMobile ? "h-9 w-9" : "h-7 w-7")} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // New chat - centered welcome with input
  if (isNewChat) {
    return (
      <>
        <div className={cn(
          "flex-1 flex flex-col items-center justify-center bg-background relative",
          isMobile ? "p-4 pb-safe" : "p-4"
        )}>
          <div className="absolute top-3 right-3 flex items-center gap-1">
            {onOpenCommandPalette && (
              <button
                onClick={onOpenCommandPalette}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Commands"
                aria-label="Open commands"
              >
                <Command className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => modals.setHelpOpen(true)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Help"
              aria-label="Help"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <a
            href="https://github.com/jamesmurdza/background-agents"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 text-sm text-foreground/70 hover:text-foreground transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            Backgrounder is open source.
          </a>
          <div className="text-center mb-6">
            <h2 className={cn("font-semibold", isMobile ? "text-xl" : "text-2xl")}>
              What would you like to build?
            </h2>
          </div>
          {showRapidFireNotification && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Task started
            </div>
          )}
          {chatInput}
          <div className={cn(
            "text-muted-foreground mt-4 text-center",
            isMobile ? "text-sm px-4" : "text-sm"
          )}>
            <p>
              Changes will apply when you type /merge. Access tools with ⌘K.
            </p>
          </div>
        </div>
        {/* File preview modal */}
        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            fileContent={fileContents.get(previewFile.id)}
            onClose={() => setPreviewFile(null)}
            onRemove={() => {
              removeFile(previewFile.id)
              setPreviewFile(null)
            }}
            isMobile={isMobile}
          />
        )}
      </>
    )
  }

  // Chat with messages
  return (
    <div
      className="flex-1 flex flex-col bg-background min-h-0"
      data-testid="chat-container"
      data-chat-status={chat?.status}
      data-chat-id={chat?.id}
    >
      {/* Header with title - hide on mobile since we have mobile header in page.tsx */}
      {!isMobile && (
        <ChatHeader
          chat={chat}
          onUpdateChat={onUpdateChat}
          onOpenEnvVars={onOpenEnvVars}
          onOpenCommandPalette={onOpenCommandPalette}
        />
      )}

      {/* Mobile conflict bar */}
      {isMobile && inConflict && (
        <MobileConflictBar
          rebaseConflict={rebaseConflict}
          isMergeConflict={isMergeConflict}
          onAbort={() => git.handleAbortConflict?.()}
          actionLoading={git.actionLoading}
        />
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden mobile-scroll scrollbar-auto-hide",
          isMobile ? "py-3 px-[27px]" : "py-4 px-[31px]"
        )}
      >
        <div className={cn(
          "space-y-4 mx-auto",
          isMobile ? "max-w-full" : "max-w-3xl space-y-6"
        )}>
          {chat.messages.map((message, index) => {
            const isLastAssistant =
              isRunning &&
              message.role === "assistant" &&
              index === chat.messages.length - 1
            return (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isLastAssistant}
                isMobile={isMobile}
                repo={isNewRepo ? undefined : chat.repo}
                onOpenFile={onOpenFile}
                onForcePush={git.handleForcePush}
                onOpenPlan={onOpenPlan}
              />
            )
          })}
          {/* Show loading indicator when sandbox is being created */}
          {isCreating && (
            <div className="text-2xl text-muted-foreground animate-pulse">
              ...
            </div>
          )}
          {/* Surface the latest agent/streaming error inline so users see why
              their last run stopped. Cleared on the next send. */}
          {chat.status === "error" && chat.errorMessage && (
            <ErrorBanner
              key={chat.id}
              message={chat.errorMessage}
              isMobile={isMobile}
            />
          )}
          {/* Queue shelf — lives at the bottom of the scroll area so it
              scrolls out of view with the conversation. */}
          {chat.queuedMessages && chat.queuedMessages.length > 0 && (
            <div className={cn(
              "border border-b-0 border-border bg-card rounded-t-md -mb-4",
              isMobile ? "mx-4" : "mx-6"
            )}>
              {chat.queuedMessages.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 last:border-b-0"
                >
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">{m.content}</span>
                  {git.canBranch && (
                    <button
                      onClick={() => git.handleBranchQueuedMessage(m.id, m.content, m.agent, m.model)}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                      aria-label="Branch to new chat"
                      title="Branch to new chat"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  )}
                  {onRemoveQueuedMessage && (
                    <button
                      onClick={() => onRemoveQueuedMessage(m.id)}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                      aria-label="Remove queued message"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input - fixed at bottom on mobile */}
      <div className={cn(
        "bg-background",
        isMobile
          ? (hasQueued ? "px-[27px] pt-0 pb-3 pb-safe" : "px-[27px] py-3 pb-safe")
          : (hasQueued ? "px-[31px] pt-0 pb-4" : "px-[31px] pb-4 pt-2")
      )}>
        {showRapidFireNotification && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-bottom-1 duration-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Task started
          </div>
        )}
        {chatInput}
      </div>

      {/* File preview modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          fileContent={fileContents.get(previewFile.id)}
          onClose={() => setPreviewFile(null)}
          onRemove={() => {
            removeFile(previewFile.id)
            setPreviewFile(null)
          }}
          isMobile={isMobile}
        />
      )}
    </div>
  )
}
