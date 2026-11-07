"use client"

import { useRef, useEffect, useCallback, useState, type ReactNode } from "react"
import { AlertTriangle, ArrowUp, Square, ChevronDown, ListPlus, Github, Paperclip, Pencil, ListChecks, Mic, GitBranch, Cpu, Brain, Plug, Play, AlarmClock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useModals } from "@/lib/contexts"
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition"
import { useCreditWarning } from "@/lib/hooks/useCreditWarning"
import { useClickOutside } from "@/lib/hooks/useClickOutside"
import { useUpwardMenuMaxHeight } from "@/lib/hooks/useUpwardMenuMaxHeight"
import { useTwoTierCollapse } from "@/lib/hooks/useTwoTierCollapse"
import { useCollapsibleLabel } from "@/lib/hooks/useCollapsibleLabel"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { useTriggerOptionsState } from "@/lib/hooks/useTriggerOptionsState"
import { useCreateScheduledJobFromComposer } from "@/lib/hooks/useCreateScheduledJobFromComposer"
import { isModKeyPressed } from "@/lib/keyboard"
import type { Chat, Agent, CredentialFlags, PendingFile } from "@/lib/types"
import { NEW_REPOSITORY, sharedPoolProviderForModel, agentLabels, getModelLabel } from "@/lib/types"
import { basename } from "@/lib/format"
import { queuedSendNotice } from "@/lib/composer-queue"
import { PendingFilesDisplay } from "./PendingFilesDisplay"
import { DismissButton } from "./DismissButton"
import { AgentModelSelector } from "./AgentModelSelector"
import { ReasoningEffortSelector } from "./ReasoningEffortSelector"
import type { ReasoningEffortCapability } from "@background-agents/sdk/reasoning-effort"
import { reasoningEffortLabel } from "@background-agents/sdk/reasoning-effort"
import { CreditWarningBanner } from "./CreditWarningBanner"
import { RepoCombobox } from "./RepoCombobox"
import { BranchCombobox } from "./BranchCombobox"
import { McpServersCombobox } from "./McpServersCombobox"
import { AgentIcon } from "../icons/agent-icons"
import { SlashCommandMenu, type SlashCommandType } from "../SlashCommandMenu"
import { MobileSelect } from "../ui/MobileBottomSheet"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { TriggerOptionsFields } from "../scheduled-jobs/TriggerOptionsFields"

// =============================================================================
// ChatInput - The main chat input area with all controls
// =============================================================================

interface ChatInputProps {
  chat: Chat
  modelPickerRequest?: { chatId: string; sequence: number }
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  /** Branch-and-send: create a sibling chat and dispatch there (Cmd/Alt/Ctrl held). */
  onBranchSend?: () => void
  /** Whether branching is currently allowed (drives the send-button modifier affordance). */
  canBranch?: boolean
  onStop: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  // File upload
  pendingFiles: PendingFile[]
  fileContents: Map<string, string>
  fileError: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isDraggingOver: boolean
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
  /** True when the agent stopped with messages still waiting in the queue. */
  isPaused?: boolean
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
  showCreditDialog: (provider?: string, creditBalance?: number | null) => void
  // Plan mode
  planModeEnabled: boolean
  planModeSupported: boolean
  onSetPlanMode: (enabled: boolean) => void
  reasoningEffort?: string
  onReasoningEffortChange?: (value: string) => void
  reasoningEffortCapability?: ReasoningEffortCapability
  // MCP servers (chat-scoped, draft-aware)
  showMcpButton: boolean
  isDraftChat: boolean
  onMaterializeDraftForMcp: (draftId: string) => Promise<string | null>
  // Mobile
  isMobile: boolean
}

interface ChatActionSlotProps {
  canStop?: boolean
  isRunning: boolean
  /** True when the agent stopped with messages still waiting in the queue. */
  isPaused?: boolean
  /** Whether the composer textarea is currently empty. */
  isInputEmpty?: boolean
  canQueue: boolean
  canSend: boolean
  isMobile: boolean
  showBranchAffordance: boolean
  onSend: (e?: React.MouseEvent) => void
  onStop: () => void
}

/**
 * Keeps the far-right composer action in a stable, fixed-size slot.
 *
 * The wrapper intentionally remains mounted while idle. Otherwise, when a run
 * finishes, the adjacent microphone control shifts into the Stop button's old
 * hit target and can receive a click that was intended to stop the agent.
 */
export function ChatActionSlot({
  canStop = true,
  isRunning,
  isPaused = false,
  isInputEmpty = false,
  canQueue,
  canSend,
  isMobile,
  showBranchAffordance,
  onSend,
  onStop,
}: ChatActionSlotProps) {
  return (
    <div
      data-testid="chat-action-slot"
      className={cn(
        "shrink-0 flex items-center justify-center",
        isMobile ? "h-9 w-9" : "h-7 w-7"
      )}
    >
      {isRunning && canQueue ? (
        <button
          type="button"
          onClick={onSend}
          title="Queue message (sent after current response)"
          aria-label="Queue message"
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          {/* ListPlus (not ArrowUp) so a queued send reads differently from an
              immediate one at a glance, not just via the tooltip. */}
          <ListPlus className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        </button>
      ) : isRunning ? (
        <button
          type="button"
          onClick={onStop}
          disabled={!canStop}
          title={canStop ? "Stop agent" : "Agent is starting"}
          aria-label="Stop agent"
          className={cn(
            "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-wait",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <Square className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")} />
        </button>
      ) : canSend && isPaused && isInputEmpty ? (
        <button
          type="button"
          onClick={onSend}
          title="Resume queued prompts"
          aria-label="Resume queued prompts"
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <Play className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5", "fill-current")} />
        </button>
      ) : canSend ? (
        <button
          type="button"
          onClick={onSend}
          title={showBranchAffordance ? "Send to a new branch" : undefined}
          aria-label={showBranchAffordance ? "Send to a new branch" : "Send message"}
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          {showBranchAffordance ? (
            <GitBranch className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          ) : (
            <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          )}
        </button>
      ) : null}
    </div>
  )
}

interface ComposerGroupItem {
  icon: ReactNode
  /** Omit entirely (not just empty string) to render this item icon-only. */
  label?: string
  chevron?: boolean
}

/**
 * Hidden, off-screen twin of one composer trigger group (left or right),
 * rendered at its full natural footprint — real icons and real label text,
 * but no interactivity or data fetching — purely so useTwoTierCollapse can
 * measure how much room the group would need without touching what's
 * actually on screen (see that hook for why).
 */
function ComposerGroupMeasure({ groupRef, items }: { groupRef: React.Ref<HTMLDivElement>; items: ComposerGroupItem[] }) {
  return (
    <div
      ref={groupRef}
      aria-hidden="true"
      className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-2"
    >
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1 whitespace-nowrap">
          {item.icon}
          {item.label !== undefined && <span>{item.label}</span>}
          {item.chevron && <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
        </span>
      ))}
    </div>
  )
}

export function ChatInput({
  modelPickerRequest,
  chat,
  input,
  onInputChange,
  onSend,
  onBranchSend,
  canBranch = false,
  onStop,
  onKeyDown,
  textareaRef,
  // File upload
  pendingFiles,
  fileContents,
  fileError,
  fileInputRef,
  isDraggingOver,
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
  isPaused = false,
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
  showCreditDialog,
  // Plan mode
  planModeEnabled,
  planModeSupported,
  onSetPlanMode,
  reasoningEffort = "default",
  onReasoningEffortChange,
  reasoningEffortCapability,
  // MCP servers
  showMcpButton,
  isDraftChat,
  onMaterializeDraftForMcp,
  // Mobile
  isMobile,
}: ChatInputProps) {
  const modals = useModals()
  const queueNotice = queuedSendNotice({ isRunning,
    isPaused: !!chat.queuePaused && !!chat.queuedMessages?.length,
    hasFiles: pendingFiles.length > 0, planMode: planModeEnabled, hasText: !!input.trim() })
  // Keyed off the *current* agent+model, so switching to a free model or an
  // own-key one clears the warning along with the charge it was warning about.
  const creditWarning = useCreditWarning({
    agent: currentAgent,
    model: currentModel,
    credentialFlags,
  })
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModeSheet, setShowModeSheet] = useState(false)
  const modeDropdownContainerRef = useRef<HTMLDivElement>(null)
  const modeDropdownRef = useRef<HTMLDivElement>(null)
  const modeDropdownMaxHeight = useUpwardMenuMaxHeight(showModeDropdown, modeDropdownRef)
  // The left (repo/branch/MCP) and right (mode/reasoning effort/agent/model)
  // trigger groups collapse their labels to icon-only as a pair, in
  // priority order — right first, left only once right is already fully
  // collapsed and it's still not enough — rather than each trigger (or a
  // fixed breakpoint) deciding independently. See useTwoTierCollapse.
  const {
    containerRef: composerRowRef,
    leftNaturalRef, leftCollapsedRef,
    rightNaturalRef, rightCollapsedRef,
    showLeft: showLeftLabels, showRight: showRightLabels,
  } = useTwoTierCollapse()
  // Desktop's left/right groups sit in one shared horizontal row and
  // compete for the same space, so they collapse as a coordinated pair
  // above. Mobile stacks them as two independent full-width rows instead —
  // summing both groups' widths against one shared "available" measurement
  // would be wrong there — so the repo link (the one plain, ungrouped
  // trigger shared between both layouts) keeps its own independent
  // auto-detect for mobile specifically.
  const { itemRef: mobileRepoLinkRef, measureRef: mobileRepoLabelMeasureRef, showLabel: mobileRepoLinkFits } = useCollapsibleLabel<HTMLAnchorElement>()
  // Custom endpoints are needed to resolve the model label the same way
  // AgentModelSelector does; React Query dedupes this against its fetch.
  const { data: settingsDataForLabels } = useSettingsQuery()
  const endpointsForLabels = settingsDataForLabels?.customEndpoints

  // Whether a "branch" modifier (Cmd/Alt/Ctrl) is currently held. When it is —
  // and branching is possible — the send button turns into a "send to new
  // branch" affordance (branch icon), and clicking it branches instead of
  // sending to the current chat. Mirrors the Cmd/Alt/Ctrl+Enter keybinding.
  const [branchModifierHeld, setBranchModifierHeld] = useState(false)
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      setBranchModifierHeld(e.altKey || isModKeyPressed(e))
    }
    const clear = () => setBranchModifierHeld(false)
    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    // Reset when focus leaves the window so a stuck modifier doesn't persist.
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
      window.removeEventListener("blur", clear)
    }
  }, [])
  const showBranchAffordance = branchModifierHeld && canBranch && !!onBranchSend

  // -- Schedule-this-prompt popover (alarm-clock button) --------------------
  // Only meaningful once there's something to schedule and nothing else is
  // competing for the send affordance — mirrors the exact condition under
  // which ChatActionSlot renders its "send" (not queue/stop/resume) button.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const isComposerRepoLess = isNewRepo || !chat.repo
  const triggerOptions = useTriggerOptionsState({ isRepoLess: isComposerRepoLess, open: scheduleOpen })
  const { createJob: createScheduledJobFromComposer } = useCreateScheduledJobFromComposer({
    prompt: input,
    repo: isComposerRepoLess ? null : chat.repo,
    baseBranch: chat.baseBranch || chat.branch || "main",
    agent: currentAgent,
    model: currentModel,
    triggerType: triggerOptions.triggerType,
    effectiveIntervalMinutes: triggerOptions.effectiveIntervalMinutes,
    runAtHourLocal: triggerOptions.runAtHourLocal,
    runAtDay: triggerOptions.runAtDay,
    autoPR: triggerOptions.autoPR,
    continueFromLastRun: triggerOptions.continueFromLastRun,
    incomingToken: triggerOptions.incomingToken,
    isRepoLess: isComposerRepoLess,
    onInputChange,
  })
  const [scheduleCreating, setScheduleCreating] = useState(false)
  const handleCreateScheduledJob = useCallback(async () => {
    setScheduleCreating(true)
    try {
      await createScheduledJobFromComposer()
      setScheduleOpen(false)
    } catch (err) {
      console.error("[ChatInput] failed to create scheduled job:", err)
    } finally {
      setScheduleCreating(false)
    }
  }, [createScheduledJobFromComposer])

  // -- Speech-to-text (voice dictation) -------------------------------------
  // Keep the latest input in a ref so the recognition callback (created once
  // per render but invoked asynchronously) always reads the current value.
  const inputRef = useRef(input)
  inputRef.current = input
  // Cursor position to restore after a controlled-state update inserts text.
  const pendingSelectionRef = useRef<number | null>(null)

  const insertTranscript = useCallback((text: string) => {
    const textarea = textareaRef.current
    const current = inputRef.current
    // Determine where to insert: at the caret if focused, else append.
    const hasSelection = textarea && document.activeElement === textarea
    const start = hasSelection ? textarea.selectionStart ?? current.length : current.length
    const end = hasSelection ? textarea.selectionEnd ?? current.length : current.length

    const before = current.slice(0, start)
    const after = current.slice(end)
    // Add a space between existing text and the new chunk when needed.
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
    const insertion = (needsLeadingSpace ? " " : "") + text
    const next = before + insertion + after

    pendingSelectionRef.current = start + insertion.length
    onInputChange(next)
  }, [onInputChange, textareaRef])

  const speech = useSpeechRecognition({ onResult: insertTranscript })

  // Restore the caret after a transcript insertion re-renders the textarea.
  useEffect(() => {
    if (pendingSelectionRef.current === null) return
    const textarea = textareaRef.current
    const pos = pendingSelectionRef.current
    pendingSelectionRef.current = null
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(pos, pos)
  }, [input, textareaRef])

  const toggleListening = useCallback(() => {
    if (speech.isListening) {
      speech.stop()
    } else {
      speech.start()
    }
  }, [speech])

  // Stop dictation when a message is sent. When a branch modifier is held (and
  // branching is possible), send to a new branch instead of the current chat.
  const handleSendWithSpeechStop = useCallback((e?: React.MouseEvent) => {
    if (speech.isListening) speech.stop()
    if (e && (e.altKey || isModKeyPressed(e)) && canBranch && onBranchSend) {
      onBranchSend()
      return
    }
    onSend()
  }, [speech, onSend, onBranchSend, canBranch])

  // Close mode dropdown when clicking outside (desktop only)
  useClickOutside(
    modeDropdownContainerRef,
    useCallback(() => setShowModeDropdown(false), []),
    showModeDropdown && !isMobile
  )

  // Mode options for mobile bottom sheet
  const modeOptions = [
    { value: "edit", label: "Edit", icon: <Pencil className="h-5 w-5" /> },
    { value: "plan", label: "Plan", icon: <ListChecks className="h-5 w-5" /> },
  ]

  const agentModelSelector = (
    <AgentModelSelector
      chat={chat}
      modelPickerRequest={modelPickerRequest}
      credentialFlags={credentialFlags}
      currentAgent={currentAgent}
      currentModel={currentModel}
      onUpdateChat={onUpdateChat}
      showCreditDialog={showCreditDialog}
      isMobile={isMobile}
      onDropdownOpen={() => setShowModeDropdown(false)}
      closeDropdowns={showModeDropdown}
      forceShowLabel={showRightLabels}
    />
  )

  // Label text for the left/right measurement clones below — mirrors what
  // each real trigger actually displays (see useTwoTierCollapse).
  const repoLabelText = showRepoButton
    ? (isNewRepo ? "Repository" : (chat.repo ? basename(chat.repo) : "Repository"))
    : (chat.repo ? basename(chat.repo) : "")
  const branchLabelText = chat.branch || chat.baseBranch || ""
  const showReasoningEffortTrigger = Boolean(
    onReasoningEffortChange && reasoningEffortCapability && reasoningEffortCapability.levels.length > 0
  )
  const reasoningEffortLabelText = !reasoningEffort || reasoningEffort === "default"
    ? reasoningEffortLabel(reasoningEffortCapability?.defaultLevel ?? "medium")
    : reasoningEffortLabel(reasoningEffort)
  const modeLabelText = planModeEnabled ? "Plan" : "Edit"
  const modelLabelText = getModelLabel(currentAgent, currentModel, endpointsForLabels)

  const leftGroupItems: ComposerGroupItem[] = [
    { icon: <Paperclip className="h-3.5 w-3.5 shrink-0" /> },
    ...(showRepoButton || !isNewRepo ? [{
      icon: <Github className="h-3.5 w-3.5 shrink-0" />,
      label: repoLabelText,
      chevron: showRepoButton,
    }] : []),
    ...(showRepoButton && !isNewRepo && isNewChat ? [{
      icon: <GitBranch className="h-3.5 w-3.5 shrink-0" />,
      label: branchLabelText,
      chevron: true,
    }] : []),
    ...(showMcpButton ? [{
      icon: <Plug className="h-3.5 w-3.5 shrink-0" />,
      label: "MCP",
      chevron: true,
    }] : []),
  ]
  const rightGroupItems: ComposerGroupItem[] = [
    ...(planModeSupported ? [{
      icon: planModeEnabled ? <ListChecks className="h-3.5 w-3.5 shrink-0" /> : <Pencil className="h-3.5 w-3.5 shrink-0" />,
      label: modeLabelText,
      chevron: true,
    }] : []),
    ...(showReasoningEffortTrigger ? [{
      icon: <Brain className="h-3.5 w-3.5 shrink-0" />,
      label: reasoningEffortLabelText,
      chevron: true,
    }] : []),
    { icon: <AgentIcon agent={currentAgent} className="h-3.5 w-3.5" />, label: agentLabels[currentAgent], chevron: true },
    { icon: <Cpu className="h-3.5 w-3.5 shrink-0" />, label: modelLabelText, chevron: true },
  ]
  const withoutLabels = (items: ComposerGroupItem[]): ComposerGroupItem[] =>
    items.map(({ icon, chevron }) => ({ icon, chevron }))

  return (
    <div className={cn(
      "w-full mx-auto",
      isMobile ? "max-w-full" : "max-w-[52rem]"
    )}>
      {/* Low/empty credit warning — above the composer, so it reads as context
          for the send the user is about to make rather than as a message in the
          conversation. */}
      {creditWarning.tier && (
        <div className="mb-2">
          <CreditWarningBanner
            tier={creditWarning.tier}
            balanceUsd={creditWarning.balanceUsd}
            onAddCredits={() => showCreditDialog(sharedPoolProviderForModel(currentAgent, currentModel, credentialFlags) ?? undefined, creditWarning.balanceUsd)}
            onDismiss={creditWarning.dismiss}
            isMobile={isMobile}
          />
        </div>
      )}

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
          accept="*/*"
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
                  ? (chat.sandboxId ? "Starting agent..." : "Creating sandbox...")
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

          {/* Voice dictation + schedule-this-prompt — grouped tightly together
              (smaller gap than the rest of the action row) since they're both
              "composer utility" actions, distinct from send. Bottom-aligned as
              the textarea grows. */}
          <div className="flex items-end gap-0.5">
            {/* Voice dictation (speech-to-text). Only shown when supported. */}
            {speech.isSupported && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={speech.permissionDenied}
                aria-pressed={speech.isListening}
                className={cn(
                  "shrink-0 flex items-center justify-center rounded-md transition-colors",
                  isMobile ? "h-9 w-9" : "h-7 w-7",
                  speech.permissionDenied
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : speech.isListening
                    ? "text-red-500 bg-red-500/10 animate-pulse cursor-pointer"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                )}
                title={
                  speech.permissionDenied
                    ? "Microphone access denied"
                    : speech.isListening
                    ? "Stop dictation"
                    : "Dictate prompt"
                }
                aria-label={
                  speech.permissionDenied
                    ? "Microphone access denied"
                    : speech.isListening
                    ? "Stop voice dictation"
                    : "Start voice dictation"
                }
              >
                <Mic className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </button>
            )}

            {/* Schedule this prompt — always visible on the composer; disabled
                (not hidden) when there's no prompt text to schedule yet.
                Doesn't depend on a repo being selected. */}
            <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isRunning || !canSend || !input.trim()}
                  aria-label="Schedule this prompt"
                  title="Schedule this prompt"
                  className={cn(
                    "shrink-0 flex items-center justify-center rounded-md transition-colors",
                    isMobile ? "h-9 w-9" : "h-7 w-7",
                    isRunning || !canSend || !input.trim()
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground cursor-pointer"
                  )}
                >
                  <AlarmClock className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="top" sideOffset={8} className="w-[28rem] space-y-4">
                <TriggerOptionsFields {...triggerOptions} />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCreateScheduledJob}
                    disabled={scheduleCreating}
                    className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                  >
                    {scheduleCreating ? "Creating..." : "Create"}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Send / stop / queue button — the slot remains mounted while idle
              so the adjacent microphone never replaces its hit target. */}
          <ChatActionSlot
            canStop={chat.status === "running" && !!chat.backgroundSessionId && !!chat.activeAssistantMessageId}
            isRunning={isRunning}
            isPaused={isPaused}
            isInputEmpty={!input.trim()}
            canQueue={canQueue}
            canSend={canSend}
            isMobile={isMobile}
            showBranchAffordance={showBranchAffordance}
            onSend={handleSendWithSpeechStop}
            onStop={onStop}
          />
        </div>

        {queueNotice && (
          <p role="status" data-testid="queue-options-notice" className={cn("text-muted-foreground", isMobile ? "mx-3 mb-2 text-sm" : "mx-4 mb-2 text-xs")}>
            {queueNotice}
          </p>
        )}

        {/* File upload error message */}
        {fileError && (
          <div className={cn(
            "flex items-start gap-2 text-destructive bg-destructive/10 rounded-md",
            isMobile ? "mx-3 mb-2 px-3 py-2 text-sm" : "mx-4 mb-2 px-3 py-2 text-xs"
          )}>
            <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            <span className="flex-1">{fileError}</span>
            <DismissButton label="Dismiss error" onClick={onClearFileError} isMobile={isMobile} variant="destructive" />
          </div>
        )}

        {/* Bottom row with selectors */}
        <div ref={composerRowRef} className={cn(
          "@container",
          isMobile ? "flex flex-col gap-1 px-3 pb-2 pt-1" : "flex items-center gap-3 px-4 py-2"
        )}>
          {/* Left side items */}
          <div className={cn("flex items-center gap-2", isMobile ? "w-full" : "grow shrink-0 basis-auto")}>
            {/* Attachment button — same hit-target size as the mic/send/stop
                buttons on the other side of the textarea. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                isMobile ? "h-9 w-9" : "h-7 w-7"
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
                  showLabel={isMobile ? undefined : showLeftLabels}
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
                    showLabel={isMobile ? undefined : showLeftLabels}
                  />
                )}
                {!isNewRepo && onUpdateChat && canSelectExistingRepo && (
                  <DismissButton
                    label="Remove repository"
                    onClick={() => onUpdateChat({ repo: NEW_REPOSITORY, baseBranch: "main" })}
                    isMobile={isMobile}
                  />
                )}
              </div>
            ) : !isNewRepo && (
              <>
                <a
                  ref={isMobile ? mobileRepoLinkRef : undefined}
                  href={`https://github.com/${chat.repo}/tree/${chat.branch}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 overflow-hidden text-muted-foreground hover:text-foreground transition-colors text-sm"
                  title={chat.repo}
                >
                  <Github className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
                  <span className={cn("whitespace-nowrap", (isMobile ? mobileRepoLinkFits : showLeftLabels) ? "inline" : "hidden")}>
                    {chat.repo ? basename(chat.repo) : undefined}
                  </span>
                </a>
                {/* Mobile-only measurement clone — see the mobileRepoLinkRef
                    comment above for why mobile can't use the desktop
                    left/right coordinator. */}
                {isMobile && (
                  <span
                    ref={mobileRepoLabelMeasureRef}
                    aria-hidden="true"
                    className="pointer-events-none invisible fixed left-0 top-0 flex items-center gap-1 whitespace-nowrap text-sm"
                  >
                    <Github className="h-4 w-4 shrink-0" />
                    <span>{chat.repo ? basename(chat.repo) : undefined}</span>
                  </span>
                )}
              </>
            )}

            {/* MCP servers picker */}
            {showMcpButton && (
              <McpServersCombobox
                entityId={chat.id}
                apiBase="/api/chats"
                isDraft={isDraftChat}
                onMaterializeDraft={onMaterializeDraftForMcp}
                open={modals.mcpServersModalOpen}
                onOpenChange={modals.setMcpServersModalOpen}
                isMobile={isMobile}
                showLabel={isMobile ? undefined : showLeftLabels}
              />
            )}

            {/* Hidden measurement twins deciding showLeftLabels — see
                useTwoTierCollapse and ComposerGroupMeasure. */}
            {!isMobile && (
              <>
                <ComposerGroupMeasure groupRef={leftNaturalRef} items={leftGroupItems} />
                <ComposerGroupMeasure groupRef={leftCollapsedRef} items={withoutLabels(leftGroupItems)} />
              </>
            )}

            {/* Spacer - only on desktop */}
            {!isMobile && <div className="flex-1" />}
          </div>

          {/* Agent/model first on mobile; keep keyboard order aligned with the layout. */}
          <div className={cn("flex items-center gap-2 min-w-0", isMobile ? "w-full @container/row2 border-t border-border/50 pt-1" : "shrink-0 flex-nowrap")}>
            {isMobile && agentModelSelector}
            {/* Mode selector dropdown (Edit/Plan) - only show if agent supports plan mode */}
            {planModeSupported && (
              isMobile ? (
                <>
                  <button
                    onClick={() => setShowModeSheet(true)}
                    aria-label={planModeEnabled ? "Plan mode" : "Edit mode"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={planModeEnabled ? "Plan mode — agent will plan before acting" : "Edit mode — agent will edit code directly"}
                  >
                    {planModeEnabled ? (
                      <ListChecks className="h-4 w-4" />
                    ) : (
                      <Pencil className="h-4 w-4" />
                    )}
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
                <div ref={modeDropdownContainerRef} className="relative">
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
                    <span className={cn("whitespace-nowrap", showRightLabels ? "inline" : "hidden")}>
                      {planModeEnabled ? "Plan" : "Edit"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {showModeDropdown && (
                    <div
                      ref={modeDropdownRef}
                      style={{ maxHeight: modeDropdownMaxHeight }}
                      className="absolute bottom-full right-0 mb-1 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-32"
                    >
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

            {onReasoningEffortChange && reasoningEffortCapability && (
              <ReasoningEffortSelector
                isMobile={isMobile}
                capability={reasoningEffortCapability}
                value={reasoningEffort}
                onChange={onReasoningEffortChange}
                forceShowLabel={showRightLabels}
              />
            )}
            {/* Agent and Model selectors */}
            {!isMobile && agentModelSelector}

            {/* Hidden measurement twins deciding showRightLabels — see
                useTwoTierCollapse and ComposerGroupMeasure. */}
            {!isMobile && (
              <>
                <ComposerGroupMeasure groupRef={rightNaturalRef} items={rightGroupItems} />
                <ComposerGroupMeasure groupRef={rightCollapsedRef} items={withoutLabels(rightGroupItems)} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
