"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { ArrowUp, Square, ChevronDown, Github, Key, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Settings, Agent, ModelOption } from "@/lib/types"
import { NEW_REPOSITORY, agentModels, agentLabels, getModelLabel, hasCredentialsForModel } from "@/lib/types"
import { getCredentialFlags } from "@/lib/storage"
import { filterSlashCommands } from "@upstream/common"
import { MessageBubble } from "./MessageBubble"
import { AgentIcon } from "./icons/agent-icons"
import { MobileSelect } from "./ui/MobileBottomSheet"
import { SlashCommandMenu, type SlashCommandType } from "./SlashCommandMenu"

import type { HighlightKey } from "./modals/SettingsModal"

interface ChatPanelProps {
  chat: Chat | null
  settings: Settings
  onSendMessage: (message: string, agent: string, model: string) => void
  onStopAgent: () => void
  onChangeRepo?: () => void
  onUpdateChat?: (updates: Partial<Chat>) => void
  onOpenSettings?: (highlightKey?: HighlightKey) => void
  onSlashCommand?: (command: SlashCommandType) => void
  isMobile?: boolean
}

export function ChatPanel({ chat, settings, onSendMessage, onStopAgent, onChangeRepo, onUpdateChat, onOpenSettings, onSlashCommand, isMobile = false }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false)
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  // Mobile bottom sheet states
  const [showAgentSheet, setShowAgentSheet] = useState(false)
  const [showModelSheet, setShowModelSheet] = useState(false)
  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Get current agent/model (from chat or settings)
  const currentAgent = (chat?.agent || settings.defaultAgent) as Agent
  const currentModel = chat?.model || settings.defaultModel

  // Get credential flags based on current settings
  const credentialFlags = useMemo(() => getCredentialFlags(settings), [settings])

  // Check if the selected model has required credentials
  const availableModels = agentModels[currentAgent] ?? []
  const selectedModelConfig = availableModels.find(m => m.value === currentModel)
  const hasRequiredCredentials = selectedModelConfig
    ? hasCredentialsForModel(selectedModelConfig, credentialFlags, currentAgent)
    : true

  const isRunning = chat?.status === "running"
  const isCreating = chat?.status === "creating"
  const canSend = input.trim() && !isRunning && !isCreating

  // Track if user has scrolled up from bottom
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    setUserHasScrolledUp(!isAtBottom)
  }

  // Auto-scroll to bottom when messages change (only if user hasn't scrolled up)
  useEffect(() => {
    if (!userHasScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [chat?.messages, userHasScrolledUp])

  // Focus prompt when switching chats (desktop only)
  useEffect(() => {
    if (!isMobile) {
      textareaRef.current?.focus()
    }
  }, [chat?.id, isMobile])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const maxHeight = isMobile ? 120 : 200
      textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px"
    }
  }, [input, isMobile])

  // Close dropdowns when clicking outside (desktop only)
  useEffect(() => {
    if (isMobile) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowAgentDropdown(false)
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMobile])

  // Update slash menu visibility based on input
  useEffect(() => {
    if (input.startsWith("/")) {
      setSlashMenuOpen(true)
    } else {
      setSlashMenuOpen(false)
      setSlashSelectedIndex(0)
    }
  }, [input])

  // Get filtered commands for keyboard navigation
  const filteredCommands = useMemo(() => filterSlashCommands(input), [input])

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback((command: SlashCommandType) => {
    setSlashMenuOpen(false)
    setSlashSelectedIndex(0)
    setInput("")
    onSlashCommand?.(command)
  }, [onSlashCommand])

  const handleSend = () => {
    if (!canSend) return
    // Don't send if credentials are missing - the UI shows a warning instead
    if (!hasRequiredCredentials) return
    onSendMessage(input.trim(), currentAgent, currentModel)
    setInput("")
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

    // Normal enter to send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAgentChange = (agent: Agent) => {
    setShowAgentDropdown(false)
    setShowAgentSheet(false)
    // Update chat's agent if possible
    if (chat && onUpdateChat) {
      const models = agentModels[agent] ?? []
      const newModel = models[0]?.value || currentModel
      onUpdateChat({ agent, model: newModel })

      // Check if the new model requires credentials we don't have
      const newModelConfig = models.find(m => m.value === newModel)
      if (newModelConfig && !hasCredentialsForModel(newModelConfig, credentialFlags, agent)) {
        // Open settings with the required key highlighted
        const requiredKey = newModelConfig.requiresKey
        if (requiredKey && requiredKey !== "none" && onOpenSettings) {
          onOpenSettings(requiredKey as HighlightKey)
        }
      }
    }
  }

  const handleModelChange = (model: string) => {
    setShowModelDropdown(false)
    setShowModelSheet(false)
    if (chat && onUpdateChat) {
      onUpdateChat({ model })

      // Check if the new model requires credentials we don't have
      const newModelConfig = availableModels.find(m => m.value === model)
      if (newModelConfig && !hasCredentialsForModel(newModelConfig, credentialFlags, currentAgent)) {
        // Open settings with the required key highlighted
        const requiredKey = newModelConfig.requiresKey
        if (requiredKey && requiredKey !== "none" && onOpenSettings) {
          onOpenSettings(requiredKey as HighlightKey)
        }
      }
    }
  }

  // No chat selected - show loading state while creating
  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h2 className={cn("font-semibold mb-2", isMobile ? "text-xl" : "text-2xl")}>Loading...</h2>
        </div>
      </div>
    )
  }

  const isNewRepo = chat.repo === NEW_REPOSITORY
  // Can select an existing repo only before first message and sandbox creation
  const canSelectRepo = chat.messages.length === 0 && !chat.sandboxId
  // Can create a new repo anytime if still on NEW_REPOSITORY (even after sandbox is created)
  const canCreateRepo = isNewRepo
  // Show the repo button if either action is available
  const showRepoButton = canSelectRepo || canCreateRepo
  const isNewChat = chat.messages.length === 0

  const agents: Agent[] = ["claude-code", "opencode", "codex", "gemini", "goose", "pi"]

  // Prepare agent options for mobile bottom sheet
  const agentOptions = agents.map(agent => ({
    value: agent,
    label: agentLabels[agent],
    icon: <AgentIcon agent={agent} className="h-5 w-5" />,
  }))

  // Prepare model options for mobile bottom sheet
  const modelOptions = availableModels.map((model: ModelOption) => {
    const modelHasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
    const needsKey = model.requiresKey !== "none" && !modelHasCredentials
    return {
      value: model.value,
      label: model.label,
      description: needsKey ? "Requires API key" : undefined,
      icon: needsKey ? <Key className="h-5 w-5 text-red-500" /> : undefined,
    }
  })

  // Chat input component - responsive design
  const chatInput = (
    <div className={cn(
      "w-full mx-auto",
      isMobile ? "max-w-full" : "max-w-[52rem]"
    )}>
      <div
        className={cn(
          "flex flex-col border shadow-sm bg-card",
          isMobile ? "rounded-xl border-border" : "rounded-2xl border-border",
          "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        )}
      >
        {/* Text input area */}
        <div className={cn(
          "flex items-end gap-2",
          isMobile ? "px-3 py-2" : "px-4 py-3"
        )}>
          {/* Textarea wrapper with slash command menu */}
          <div className="relative flex-1">
            {/* Slash Command Menu - positioned above the textarea */}
            {onSlashCommand && (
              <SlashCommandMenu
                input={input}
                open={slashMenuOpen}
                onSelect={handleSlashCommandSelect}
                onClose={() => {
                  setSlashMenuOpen(false)
                  setSlashSelectedIndex(0)
                }}
                selectedIndex={slashSelectedIndex}
                onSelectedIndexChange={setSlashSelectedIndex}
                isMobile={isMobile}
              />
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isCreating
                  ? "Creating sandbox..."
                  : isRunning
                  ? "Agent is working..."
                  : "Message..."
              }
              rows={1}
              disabled={isCreating}
              className={cn(
                "w-full resize-none bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50",
                isMobile ? "text-base" : "text-sm"
              )}
            />
          </div>

          {/* Button container - larger on mobile */}
          <div className={cn(
            "shrink-0",
            isMobile ? "w-11 h-11" : "w-8 h-8"
          )}>
            {isRunning ? (
              <button
                onClick={onStopAgent}
                className={cn(
                  "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors touch-target",
                  isMobile ? "h-11 w-11" : "h-8 w-8"
                )}
              >
                <Square className={cn(isMobile ? "h-4 w-4" : "h-3 w-3", "fill-current")} />
              </button>
            ) : canSend ? (
              <button
                onClick={handleSend}
                className={cn(
                  "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors touch-target",
                  isMobile ? "h-11 w-11" : "h-8 w-8"
                )}
              >
                <ArrowUp className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
              </button>
            ) : null}
          </div>
        </div>

        {/* Bottom row with selectors */}
        <div className={cn(
          "flex items-center gap-2 border-t border-border/50",
          isMobile ? "px-3 py-2 flex-wrap" : "px-4 py-2 gap-4"
        )}>
          {/* Repo selector - show if can select or create repo */}
          {showRepoButton && (
            <div className="flex items-center gap-1">
              {onChangeRepo && (
                <button
                  onClick={onChangeRepo}
                  className={cn(
                    "flex items-center gap-1 text-muted-foreground hover:text-foreground active:text-foreground transition-colors",
                    isMobile ? "text-sm py-1 px-2 rounded-md hover:bg-accent/50" : "text-xs"
                  )}
                >
                  {isNewRepo ? "Repository" : chat.repo}
                  <ChevronDown className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                </button>
              )}
              {!isNewRepo && onUpdateChat && canSelectRepo && (
                <button
                  onClick={() => onUpdateChat({ repo: NEW_REPOSITORY, baseBranch: "main" })}
                  className={cn(
                    "rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors",
                    isMobile ? "p-1.5" : "p-0.5"
                  )}
                  title="Remove repository"
                >
                  <X className={cn(isMobile ? "h-4 w-4" : "h-3 w-3")} />
                </button>
              )}
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Agent selector */}
          {isMobile ? (
            // Mobile: Use bottom sheet
            <button
              onClick={() => setShowAgentSheet(true)}
              className="flex items-center gap-1 text-sm py-1 px-2 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              <AgentIcon agent={currentAgent} className="h-4 w-4" />
              {agentLabels[currentAgent]}
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : (
            // Desktop: Use dropdown
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowAgentDropdown(!showAgentDropdown)
                  setShowModelDropdown(false)
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
              >
                <AgentIcon agent={currentAgent} className="h-3.5 w-3.5" />
                {agentLabels[currentAgent]}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showAgentDropdown && (
                <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40">
                  {agents.map((agent) => (
                    <button
                      key={agent}
                      onClick={() => handleAgentChange(agent)}
                      className={cn(
                        "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-xs",
                        agent === currentAgent && "bg-accent"
                      )}
                    >
                      <AgentIcon agent={agent} className="h-3.5 w-3.5" />
                      {agentLabels[agent]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Model selector */}
          {isMobile ? (
            // Mobile: Use bottom sheet
            <button
              onClick={() => setShowModelSheet(true)}
              className={cn(
                "flex items-center gap-1 text-sm py-1 px-2 rounded-md hover:bg-accent/50 transition-colors",
                !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {!hasRequiredCredentials && <Key className="h-4 w-4" />}
              {getModelLabel(currentAgent, currentModel)}
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : (
            // Desktop: Use dropdown
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowModelDropdown(!showModelDropdown)
                  setShowAgentDropdown(false)
                }}
                className={cn(
                  "flex items-center gap-1 text-xs transition-colors",
                  !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {!hasRequiredCredentials && <Key className="h-3 w-3" />}
                {getModelLabel(currentAgent, currentModel)}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showModelDropdown && (
                <div className="absolute bottom-full right-0 mb-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52">
                  {availableModels.map((model: ModelOption) => {
                    const modelHasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
                    const needsKey = model.requiresKey !== "none" && !modelHasCredentials
                    return (
                      <button
                        key={model.value}
                        onClick={() => handleModelChange(model.value)}
                        className={cn(
                          "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center justify-between px-3 py-1.5 text-xs",
                          model.value === currentModel && "bg-accent"
                        )}
                      >
                        <span>{model.label}</span>
                        {needsKey && <Key className="h-3 w-3 text-red-500 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Mobile Bottom Sheets */}
      {isMobile && (
        <>
          <MobileSelect
            open={showAgentSheet}
            onClose={() => setShowAgentSheet(false)}
            title="Select Agent"
            options={agentOptions}
            value={currentAgent}
            onChange={(value) => handleAgentChange(value as Agent)}
          />
          <MobileSelect
            open={showModelSheet}
            onClose={() => setShowModelSheet(false)}
            title="Select Model"
            options={modelOptions}
            value={currentModel}
            onChange={handleModelChange}
          />
        </>
      )}
    </div>
  )

  // New chat - centered welcome with input
  if (isNewChat) {
    return (
      <div className={cn(
        "flex-1 flex flex-col items-center justify-center bg-background",
        isMobile ? "p-4 pb-safe" : "p-4"
      )}>
        <div className="text-center mb-6">
          <h2 className={cn("font-semibold", isMobile ? "text-xl" : "text-2xl")}>
            What would you like to build?
          </h2>
        </div>
        {chatInput}
        <p className={cn(
          "text-muted-foreground mt-4 text-center",
          isMobile ? "text-sm px-4" : "text-sm"
        )}>
          Agents are isolated in Daytona sandboxes and tied to Git branches.
        </p>
      </div>
    )
  }

  const chatTitle = chat.displayName || "Untitled"
  // Only show GitHub link after branch has been created and pushed (sandboxId exists means branch was pushed)
  const hasBranchOnGitHub = !isNewRepo && chat.branch && chat.sandboxId
  const githubBranchUrl = hasBranchOnGitHub
    ? `https://github.com/${chat.repo}/tree/${chat.branch}`
    : null

  // Chat with messages
  return (
    <div className="flex-1 flex flex-col bg-background min-h-0">
      {/* Header with title - hide on mobile since we have mobile header in page.tsx */}
      {!isMobile && (
        <div className="flex items-center justify-between pt-3" style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}>
          <h1 className="text-sm font-medium text-foreground">{chatTitle}</h1>
          {githubBranchUrl && (
            <a
              href={githubBranchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="View branch on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          )}
        </div>
      )}

      {/* Mobile GitHub link - show as a subtle bar if branch exists */}
      {isMobile && githubBranchUrl && (
        <a
          href={githubBranchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground bg-muted/30 border-b border-border"
        >
          <Github className="h-3.5 w-3.5" />
          View on GitHub
        </a>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className={cn(
          "flex-1 overflow-y-auto mobile-scroll",
          isMobile ? "p-3" : "p-4"
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
              />
            )
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input - fixed at bottom on mobile */}
      <div className={cn(
        "border-t border-border bg-background",
        isMobile ? "px-3 py-3 pb-safe" : "px-4 pb-4 pt-2"
      )}>
        {chatInput}
      </div>
    </div>
  )
}
