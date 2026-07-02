"use client"

import {
  ChatHeader,
  MobileConflictBar,
  ChatInput,
  FilePreviewModal,
  ChatPanelSkeleton,
  WelcomeView,
  ChatMessageList,
} from "./chat"
import { cn } from "@/lib/utils"
import type { Chat, Settings, CredentialFlags } from "@/lib/types"
import { NEW_REPOSITORY, agentSupportsPlanMode } from "@/lib/types"
import type { SlashCommandType } from "./SlashCommandMenu"
import { useChatComposer } from "@/lib/hooks/useChatComposer"

interface ChatPanelProps {
  chat: Chat | null
  settings: Settings
  credentialFlags: CredentialFlags
  showClaudeLimitDialog: () => void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  /** Refresh the chat history after the SSE stream died (status === "disconnected"). */
  onReload?: (chatId: string) => Promise<void> | void
  onEnqueueMessage?: (message: string, agent?: string, model?: string) => void
  onRemoveQueuedMessage?: (id: string) => void
  onResumeQueue?: () => void
  onStopAgent: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onSlashCommand?: (command: SlashCommandType) => void
  onOpenFile?: (filePath: string) => void
  /** Callback to open the environment variables modal */
  onOpenEnvVars?: () => void
  /** True when the current chat is a not-yet-persisted draft. */
  isDraftChat?: boolean
  /** Persists the draft chat to the DB and returns the real chatId. */
  onMaterializeDraftForMcp?: (draftId: string) => Promise<string | null>
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
  /** Whether the user is authenticated */
  isAuthenticated?: boolean
}

export function ChatPanel({ chat, settings, credentialFlags, showClaudeLimitDialog, onSendMessage, onReload, onEnqueueMessage, onRemoveQueuedMessage, onResumeQueue, onStopAgent, onUpdateChat, onSlashCommand, onOpenFile, onOpenEnvVars, isDraftChat = false, onMaterializeDraftForMcp, isMobile = false, isLoadingMessages = false, draft = "", onDraftChange, isSending = false, onOpenCommandPalette, isAuthenticated = false }: ChatPanelProps) {
  const composer = useChatComposer({
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
  })
  const {
    modals,
    git,
    input,
    setInput,
    textareaRef,
    handleSend,
    handleBranchSend,
    canBranch,
    handleKeyDown,
    messagesEndRef,
    messagesContainerRef,
    userHasScrolledUp,
    setUserHasScrolledUp,
    handleScroll,
    slashMenuOpen,
    setSlashMenuOpen,
    slashSelectedIndex,
    setSlashSelectedIndex,
    handleSlashCommandSelect,
    hasLinkedRepo,
    planModeEnabled,
    setPlanModeEnabled,
    currentAgent,
    currentModel,
    rebaseConflict,
    inConflict,
    isMergeConflict,
    hasQueued,
    isRunning,
    isCreating,
    canSend,
    canQueue,
    fileUpload,
    previewFile,
    fileContents,
    removeFile,
    setPreviewFile,
  } = composer

  // No chat selected - show a skeleton while the first chat is being created.
  if (!chat) {
    return <ChatPanelSkeleton isMobile={isMobile} titleWidth="w-40" headerWidth="w-1/3" />
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

  // File preview modal — built once, shared by the welcome and messages views.
  const filePreviewModal = previewFile ? (
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
  ) : null

  // Chat input component
  const chatInput = (
    <ChatInput
      chat={chat}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      onBranchSend={handleBranchSend}
      canBranch={canBranch}
      onStop={onStopAgent}
      onKeyDown={handleKeyDown}
      textareaRef={textareaRef}
      // File upload
      pendingFiles={fileUpload.pendingFiles}
      fileContents={fileUpload.fileContents}
      fileError={fileUpload.fileError}
      fileInputRef={fileUpload.fileInputRef}
      isDraggingOver={fileUpload.isDraggingOver}
      onDragOver={fileUpload.handleDragOver}
      onDragLeave={fileUpload.handleDragLeave}
      onDrop={fileUpload.handleDrop}
      onPaste={fileUpload.handlePaste}
      onAddFiles={fileUpload.addFiles}
      onRemoveFile={fileUpload.removeFile}
      onClearFileError={fileUpload.clearError}
      onPreviewFile={fileUpload.setPreviewFile}
      getFileTypeForFile={fileUpload.getFileTypeForFile}
      getFilePreviewUrl={fileUpload.getFilePreviewUrl}
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
      planModeSupported={agentSupportsPlanMode[currentAgent]}
      onSetPlanMode={setPlanModeEnabled}
      // MCP servers — only show when authenticated and we have a chat to attach to.
      showMcpButton={isAuthenticated && !!chat?.id && !!onMaterializeDraftForMcp}
      isDraftChat={isDraftChat}
      onMaterializeDraftForMcp={onMaterializeDraftForMcp ?? (async () => null)}
      // Mobile
      isMobile={isMobile}
    />
  )

  // Loading messages skeleton - check BEFORE isNewChat to prevent flash
  if (isLoadingMessages) {
    return <ChatPanelSkeleton isMobile={isMobile} titleWidth="w-48" headerWidth="w-1/4" />
  }

  // New chat - centered welcome with input
  if (isNewChat) {
    return (
      <WelcomeView
        isMobile={isMobile}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenHelp={() => modals.setHelpOpen(true)}
        chatInput={chatInput}
        filePreviewModal={filePreviewModal}
      />
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
      <ChatMessageList
        chat={chat}
        isMobile={isMobile}
        isRunning={isRunning}
        isCreating={isCreating}
        isNewRepo={isNewRepo}
        git={git}
        onOpenFile={onOpenFile}
        onReload={onReload}
        onSendMessage={onSendMessage}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
        currentAgent={currentAgent}
        currentModel={currentModel}
        planModeEnabled={planModeEnabled}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        onScroll={handleScroll}
        userHasScrolledUp={userHasScrolledUp}
        onScrollToBottom={() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
          setUserHasScrolledUp(false)
        }}
      />

      {/* Input - fixed at bottom on mobile */}
      <div className={cn(
        "bg-background",
        isMobile
          ? (hasQueued ? "px-[27px] pt-0 pb-3 pb-safe" : "px-[27px] py-3 pb-safe")
          : (hasQueued ? "px-[31px] pt-0 pb-4" : "px-[31px] pb-4 pt-2")
      )}>
        {chatInput}
      </div>

      {/* File preview modal */}
      {filePreviewModal}
    </div>
  )
}
