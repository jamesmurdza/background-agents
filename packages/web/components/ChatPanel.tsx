"use client"

import { useState } from "react"

import {
  ChatHeader,
  ChatInput,
  FilePreviewModal,
  ChatPanelSkeleton,
  WelcomeView,
  ChatMessageList,
} from "./chat"
import { cn } from "@/lib/utils"
import type { Chat, Settings, CredentialFlags } from "@/lib/types"
import type { PendingMcpServer } from "@/lib/storage"
import { NEW_REPOSITORY, agentSupportsPlanMode } from "@/lib/types"
import type { SlashCommandType } from "./SlashCommandMenu"
import { useChatComposer } from "@/lib/hooks/useChatComposer"

interface ChatPanelProps {
  chat: Chat | null
  settings: Settings
  credentialFlags: CredentialFlags
  showCreditDialog: (provider?: string, creditBalance?: number | null) => void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean, reasoningEffort?: string) => void
  /** Refresh the chat history after the SSE stream died (status === "disconnected"). */
  onReload?: (chatId: string) => Promise<void> | void
  onEnqueueMessage?: (message: string, agent?: string, model?: string, reasoningEffort?: string) => void
  onRemoveQueuedMessage?: (id: string) => void
  onResumeQueue?: () => void
  onStopAgent: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onSlashCommand?: (command: SlashCommandType) => void
  onOpenFile?: (filePath: string) => void
  onOpenChanges?: () => void
  /** Callback to open the environment variables modal */
  onOpenEnvVars?: () => void
  /** Callback to open the skills modal */
  onOpenSkills?: () => void
  /** True when the current chat is a not-yet-persisted draft. */
  isDraftChat?: boolean
  /** MCP servers staged on the draft chat config (draft chats only — see lib/storage.ts). */
  pendingMcpServers?: PendingMcpServer[]
  /** Updates the staged MCP server list on the draft chat config (draft chats only). */
  onPendingMcpServersChange?: (servers: PendingMcpServer[]) => void
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
  /** Whether the current user is an admin — gates the "Sandbox resources" item. */
  isAdmin?: boolean
  /** Open the sandbox resize modal. Omitted when there's no sandbox to resize. */
  onOpenSandboxResize?: () => void
  /** Opens a chat by id — same mechanism used by the sidebar/Triggers modal.
   *  Threaded down to ChatHeader for the scheduled-job "previous runs"
   *  dropdown. */
  onSelectChat?: (chatId: string) => void
}

export function ChatPanel({ chat, settings, credentialFlags, showCreditDialog, onSendMessage, onReload, onEnqueueMessage, onRemoveQueuedMessage, onResumeQueue, onStopAgent, onUpdateChat, onSlashCommand, onOpenFile, onOpenChanges, onOpenEnvVars, onOpenSkills, isDraftChat = false, pendingMcpServers, onPendingMcpServersChange, isMobile = false, isLoadingMessages = false, draft = "", onDraftChange, isSending = false, onOpenCommandPalette, isAuthenticated = false, isAdmin = false, onOpenSandboxResize, onSelectChat }: ChatPanelProps) {
  const [modelPickerRequest, setModelPickerRequest] = useState<{ chatId: string; sequence: number }>()
  const composer = useChatComposer({
    chat,
    settings,
    credentialFlags,
    draft,
    onDraftChange,
    isMobile,
    isSending,
    isAuthenticated,
    showCreditDialog,
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
    reasoningEffort,
    setReasoningEffort,
    reasoningEffortCapability,
    currentAgent,
    currentModel,
    inConflict,
    hasQueued,
    isPaused,
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
  // Only show the welcome/draft-composer screen for an actual (not yet
  // persisted) draft chat. Checking just "no messages" here used to also
  // catch a real, freshly-materialized chat (e.g. materialized via cmd-k's
  // "Open Terminal" before any message was sent) that has 0 messages for a
  // perfectly ordinary reason — it should render like any other real chat
  // with an empty history, not fall back to the welcome screen. The normal
  // first-message-send path never hits this because it adds an optimistic
  // message before the draft materializes, so messages.length is already > 0.
  const isNewChat = isDraftChat && chat.messages.length === 0 && !chat.parentChatId && !isLoadingMessages

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
      modelPickerRequest={modelPickerRequest}
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
      isPaused={isPaused}
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
      showCreditDialog={showCreditDialog}
      // Plan mode
      planModeEnabled={planModeEnabled}
      planModeSupported={agentSupportsPlanMode[currentAgent]}
      onSetPlanMode={setPlanModeEnabled}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={setReasoningEffort}
      reasoningEffortCapability={reasoningEffortCapability}
      // MCP servers — only show when authenticated and we have a chat to attach to.
      showMcpButton={isAuthenticated && !!chat?.id}
      isDraftChat={isDraftChat}
      pendingMcpServers={pendingMcpServers}
      onPendingMcpServersChange={onPendingMcpServersChange}
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
          onOpenSkills={onOpenSkills}
          onOpenCommandPalette={onOpenCommandPalette}
          isAdmin={isAdmin}
          onOpenSandboxResize={onOpenSandboxResize}
          onSelectChat={onSelectChat}
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
        onOpenChanges={onOpenChanges}
        onCreateRepo={() => modals.setRepoCreateOpen(true)}
        onAbortConflict={() => modals.setAbortConflictOpen(true)}
        onReload={onReload}
        onSendMessage={onSendMessage}
        onRemoveQueuedMessage={onRemoveQueuedMessage}
        onResumeQueue={onResumeQueue}
        onChooseModel={() => setModelPickerRequest(previous => ({ chatId: chat.id, sequence: (previous?.sequence ?? 0) + 1 }))}
        currentAgent={currentAgent}
        currentModel={currentModel}
        currentReasoningEffort={reasoningEffort}
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
