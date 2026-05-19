"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import { AlertTriangle, ArrowUp, Square, ChevronDown, Github, X, Paperclip, Pencil, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import { useModals } from "@/lib/contexts"
import type { Chat, Agent, CredentialFlags, PendingFile } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { PendingFilesDisplay } from "./PendingFilesDisplay"
import { AgentModelSelector } from "./AgentModelSelector"
import { RepoCombobox } from "./RepoCombobox"
import { BranchCombobox } from "./BranchCombobox"
import { McpServersCombobox } from "./McpServersCombobox"
import { SlashCommandMenu, type SlashCommandType } from "../SlashCommandMenu"
import { MobileSelect } from "../ui/MobileBottomSheet"

// =============================================================================
// ChatInput - The main chat input area with all controls
// =============================================================================

interface ChatInputProps {
  chat: Chat
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  // File upload
  pendingFiles: PendingFile[]
  fileContents: Map<string, string>
  fileError: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isDraggingOver: boolean
  supportedExtensions: string[]
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  onAddFiles: (files: FileList) => void
  onRemoveFile: (id: string) => void
  onClearFileError: () => void
  onPreviewFile: (file: PendingFile | null) => void
  getFileTypeForFile: (file: File) => "image" | "pdf" | "text" | "code" | "other"
  getFilePreviewUrl: (file: File) => string | null
  // Slash commands
  slashMenuOpen: boolean
  slashSelectedIndex: number
  onSlashSelect: (command: SlashCommandType) => void
  onSlashClose: () => void
  onSlashSelectedIndexChange: (index: number) => void
  hasLinkedRepo: boolean
  inConflict: boolean
  hasSlashCommands: boolean
  // State flags
  isRunning: boolean
  isCreating: boolean
  isNewChat: boolean
  canSend: boolean
  canQueue: boolean
  // Repo/branch
  showRepoButton: boolean
  isNewRepo: boolean
  canSelectExistingRepo: boolean
  onUpdateChat?: (updates: Partial<Chat>) => void
  /** Default branch for the current repo (used by BranchCombobox) */
  defaultBranch?: string
  // Agent/model
  credentialFlags: CredentialFlags
  currentAgent: Agent
  currentModel: string
  showClaudeLimitDialog: () => void
  // Plan mode
  planModeEnabled: boolean
  planModeSupported: boolean
  onPlanModeToggle: () => void
  onSetPlanMode: (enabled: boolean) => void
  // MCP servers (chat-scoped, draft-aware)
  showMcpButton: boolean
  isDraftChat: boolean
  onMaterializeDraftForMcp: (draftId: string) => Promise<string | null>
  // Mobile
  isMobile: boolean
}

export function ChatInput({
  chat,
  input,
  onInputChange,
  onSend,
  onStop,
  onKeyDown,
  textareaRef,
  // File upload
  pendingFiles,
  fileContents,
  fileError,
  fileInputRef,
  isDraggingOver,
  supportedExtensions,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  onAddFiles,
  onRemoveFile,
  onClearFileError,
  onPreviewFile,
  getFileTypeForFile,
  getFilePreviewUrl,
  // Slash commands
  slashMenuOpen,
  slashSelectedIndex,
  onSlashSelect,
  onSlashClose,
  onSlashSelectedIndexChange,
  hasLinkedRepo,
  inConflict,
  hasSlashCommands,
  // State flags
  isRunning,
  isCreating,
  isNewChat,
  canSend,
  canQueue,
  // Repo/branch
  showRepoButton,
  isNewRepo,
  canSelectExistingRepo,
  onUpdateChat,
  defaultBranch,
  // Agent/model
  credentialFlags,
  currentAgent,
  currentModel,
  showClaudeLimitDialog,
  // Plan mode
  planModeEnabled,
  planModeSupported,
  onPlanModeToggle,
  onSetPlanMode,
  // MCP servers
  showMcpButton,
  isDraftChat,
  onMaterializeDraftForMcp,
  // Mobile
  isMobile,
}: ChatInputProps) {
  const modals = useModals()
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModeSheet, setShowModeSheet] = useState(false)

  // Close mode dropdown when clicking outside (desktop only)
  useEffect(() => {
    if (isMobile) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowModeDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMobile])

  // Mode options for mobile bottom sheet
  const modeOptions = [
    { value: "edit", label: "Edit", icon: <Pencil className="h-5 w-5" /> },
    { value: "plan", label: "Plan", icon: <ListChecks className="h-5 w-5" /> },
  ]

  return (
    <div className={cn(
      "w-full mx-auto",
      isMobile ? "max-w-full" : "max-w-[52rem]"
    )}>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "relative flex flex-col border shadow-sm bg-card border-border",
          isMobile ? "rounded-xl" : "rounded-2xl",
          "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
          isDraggingOver && "border-primary ring-2 ring-primary/30"
        )}
      >
        {/* Drop zone overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 bg-primary/5 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
            <div className="text-primary text-sm font-medium">Drop files here</div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={supportedExtensions.map(ext => `.${ext}`).join(',') + ',image/*,text/*,application/pdf,application/json'}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              onAddFiles(e.target.files)
              e.target.value = ""
            }
          }}
        />

        {/* Pending files display */}
        <PendingFilesDisplay
          pendingFiles={pendingFiles}
          fileContents={fileContents}
          getFileTypeForFile={getFileTypeForFile}
          getFilePreviewUrl={getFilePreviewUrl}
          onRemoveFile={onRemoveFile}
          onPreviewFile={onPreviewFile}
          isMobile={isMobile}
        />

        {/* Text input area */}
        <div className={cn(
          "flex items-end gap-2",
          isMobile ? "px-3 py-2" : "px-4 py-3"
        )}>
          {/* Textarea wrapper with slash command menu */}
          <div className="relative flex-1">
            {/* Slash Command Menu */}
            {hasSlashCommands && (
              <SlashCommandMenu
                input={input}
                open={slashMenuOpen}
                onSelect={onSlashSelect}
                onClose={onSlashClose}
                selectedIndex={slashSelectedIndex}
                onSelectedIndexChange={onSlashSelectedIndexChange}
                hasLinkedRepo={hasLinkedRepo}
                inConflict={inConflict}
                isMobile={isMobile}
              />
            )}

            <textarea
              ref={textareaRef}
              data-chat-prompt
              data-testid="chat-input"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={
                isCreating
                  ? "Creating sandbox..."
                  : isRunning
                  ? "Agent is working..."
                  : isNewChat
                  ? "Message..."
                  : "Enter prompt or /merge..."
              }
              rows={1}
              className={cn(
                "w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none",
                isMobile ? "text-base" : "text-[15px]"
              )}
            />
          </div>

          {/* Button container */}
          <div className={cn(
            "shrink-0 flex items-center justify-center",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}>
            {isRunning && canQueue ? (
              <button
                onClick={onSend}
                title="Queue message (sent after current response)"
                className={cn(
                  "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </button>
            ) : isRunning ? (
              <button
                onClick={onStop}
                className={cn(
                  "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <Square className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")} />
              </button>
            ) : canSend ? (
              <button
                onClick={onSend}
                className={cn(
                  "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7"
                )}
              >
                <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </button>
            ) : null}
          </div>
        </div>

        {/* File upload error message */}
        {fileError && (
          <div className={cn(
            "flex items-start gap-2 text-destructive bg-destructive/10 rounded-md",
            isMobile ? "mx-3 mb-2 px-3 py-2 text-sm" : "mx-4 mb-2 px-3 py-2 text-xs"
          )}>
            <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            <span className="flex-1">{fileError}</span>
            <button
              onClick={onClearFileError}
              className="shrink-0 text-destructive/70 hover:text-destructive transition-colors"
              aria-label="Dismiss error"
            >
              <X className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>
          </div>
        )}

        {/* Bottom row with selectors */}
        <div className={cn(
          "@container",
          isMobile ? "flex flex-col gap-1 px-3 py-2" : "flex items-center gap-3 px-4 py-2"
        )}>
          {/* Left side items */}
          <div className={cn("flex items-center gap-2", isMobile ? "w-full @container/row1" : "flex-1")}>
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                isMobile ? "h-7 w-7" : "h-6 w-6"
              )}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>

            {/* Repo display/selector */}
            {showRepoButton ? (
              <div className="flex items-center gap-1">
                <RepoCombobox
                  value={isNewRepo ? null : chat.repo}
                  onChange={(repo, branch) => {
                    onUpdateChat?.({ repo, baseBranch: branch })
                  }}
                  onRequestCreate={() => modals.setRepoCreateOpen(true)}
                  createOnly={!canSelectExistingRepo && isNewRepo}
                  isMobile={isMobile}
                />
                {!isNewRepo && isNewChat && (
                  <BranchCombobox
                    repo={chat.repo}
                    value={chat.branch || chat.baseBranch}
                    onChange={(branch) => {
                      onUpdateChat?.({ baseBranch: branch })
                    }}
                    defaultBranch={defaultBranch}
                    isMobile={isMobile}
                  />
                )}
                {!isNewRepo && onUpdateChat && canSelectExistingRepo && (
                  <button
                    onClick={() => onUpdateChat({ repo: NEW_REPOSITORY, baseBranch: "main" })}
                    className={cn(
                      "text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                      isMobile ? "p-1.5" : "p-0.5"
                    )}
                    title="Remove repository"
                  >
                    <X className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                  </button>
                )}
              </div>
            ) : !isNewRepo && (
              <a
                href={`https://github.com/${chat.repo}/tree/${chat.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors",
                  isMobile ? "text-sm" : "text-sm"
                )}
                title={chat.repo}
              >
                <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                <span className={cn(isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")}>
                  {chat.repo?.split("/").pop()}
                </span>
              </a>
            )}

            {/* MCP servers picker */}
            {showMcpButton && (
              <McpServersCombobox
                chatId={chat.id}
                isDraftChat={isDraftChat}
                onMaterializeDraft={onMaterializeDraftForMcp}
                open={modals.mcpServersModalOpen}
                onOpenChange={modals.setMcpServersModalOpen}
                isMobile={isMobile}
              />
            )}

            {/* Spacer - only on desktop */}
            {!isMobile && <div className="flex-1" />}
          </div>

          {/* Right side items */}
          <div className={cn("flex items-center gap-2", isMobile && "w-full @container/row2")}>
            {/* Mode selector dropdown (Edit/Plan) - only show if agent supports plan mode */}
            {planModeSupported && (
              isMobile ? (
                <>
                  <button
                    onClick={() => setShowModeSheet(true)}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={planModeEnabled ? "Plan mode — agent will plan before acting" : "Edit mode — agent will edit code directly"}
                  >
                    {planModeEnabled ? (
                      <ListChecks className="h-4 w-4" />
                    ) : (
                      <Pencil className="h-4 w-4" />
                    )}
                    <span className="hidden @[18rem]/row2:inline">
                      {planModeEnabled ? "Plan" : "Edit"}
                    </span>
                    <ChevronDown className="h-4 w-4 hidden @[18rem]/row2:block" />
                  </button>
                  <MobileSelect
                    open={showModeSheet}
                    onClose={() => setShowModeSheet(false)}
                    title="Select Mode"
                    options={modeOptions}
                    value={planModeEnabled ? "plan" : "edit"}
                    onChange={(value) => onSetPlanMode(value === "plan")}
                  />
                </>
              ) : (
                <div className="relative" data-dropdown>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowModeDropdown(!showModeDropdown)
                    }}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer"
                    title={planModeEnabled ? "Plan mode — agent will plan before acting" : "Edit mode — agent will edit code directly"}
                  >
                    {planModeEnabled ? (
                      <ListChecks className="h-3.5 w-3.5" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden @[32rem]:inline">
                      {planModeEnabled ? "Plan" : "Edit"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {showModeDropdown && (
                    <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-32">
                      <button
                        onClick={() => {
                          onSetPlanMode(false)
                          setShowModeDropdown(false)
                        }}
                        className={cn(
                          "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                          !planModeEnabled && "bg-accent"
                        )}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onSetPlanMode(true)
                          setShowModeDropdown(false)
                        }}
                        className={cn(
                          "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                          planModeEnabled && "bg-accent"
                        )}
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        Plan
                      </button>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Agent and Model selectors */}
            <AgentModelSelector
              chat={chat}
              credentialFlags={credentialFlags}
              currentAgent={currentAgent}
              currentModel={currentModel}
              onUpdateChat={onUpdateChat}
              showClaudeLimitDialog={showClaudeLimitDialog}
              isMobile={isMobile}
              onDropdownOpen={() => setShowModeDropdown(false)}
              closeDropdowns={showModeDropdown}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
