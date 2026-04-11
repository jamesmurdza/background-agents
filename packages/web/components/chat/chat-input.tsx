"use client"

import { cn } from "@/lib/shared/utils"
import type { Agent, Branch, UserCredentialFlags, ModelOption } from "@/lib/shared/types"
import { agentLabels, getModelLabel, defaultAgentModel, getAvailableModels, hasClaudeCodeCredentials, hasCodexCredentials, hasGeminiCredentials, hasPiCredentials, hasCredentialsForModel, agentModels } from "@/lib/shared/types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import { Send, ChevronDown, Sparkles, Check, Mic } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { forwardRef, useEffect, useCallback, useState, useMemo, useRef } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command"
import { SlashCommandMenu, type SlashCommandType } from "./SlashCommandMenu"
import { filterSlashCommands } from "@upstream/common"

// ============================================================================
// Chat Input Component
// ============================================================================

interface ChatInputProps {
  branch: Branch
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onAgentChange?: (agent: Agent) => void
  onModelChange?: (model: string) => void
  onOpenSettings?: () => void
  onOpenSettingsWithHighlight?: (field: string) => void
  credentials?: UserCredentialFlags | null
  isMobile?: boolean
  /** Rebase conflict: tint the prompt strip red (message list unchanged) */
  inRebaseConflict?: boolean
  /** Slash command handlers */
  onSlashCommand?: (command: SlashCommandType) => void
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { branch, input, onInputChange, onSend, onStop, onAgentChange, onModelChange, onOpenSettings, onOpenSettingsWithHighlight, credentials, isMobile, inRebaseConflict = false, onSlashCommand },
    ref
  ) {
    // Normalize agent value (handle legacy "claude" value from database)
    const rawAgent = branch.agent as string | undefined
    const normalizedAgent = (!rawAgent || rawAgent === "claude") ? "claude-code" : rawAgent
    const currentAgent = normalizedAgent as Agent
    const currentModel = branch.model || defaultAgentModel[currentAgent]

    // State for model combobox
    const [modelOpen, setModelOpen] = useState(false)

    // Voice input state
    const [isListening, setIsListening] = useState(false)
    const recognitionRef = useRef<SpeechRecognition | null>(null)

    // Slash command menu state
    const [slashMenuOpen, setSlashMenuOpen] = useState(false)
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

    // Handle slash command selection
    const handleSlashCommandSelect = useCallback((command: SlashCommandType) => {
      setSlashMenuOpen(false)
      setSlashSelectedIndex(0)
      onInputChange("")
      onSlashCommand?.(command)
    }, [onInputChange, onSlashCommand])

    // Filter models based on available credentials
    const availableModels = getAvailableModels(currentAgent, credentials)

    // Group models by requirement for display
    const modelSections = useMemo(() => {
      const freeModels = availableModels.filter(m => m.requiresKey === "none")
      const opencodeModels = availableModels.filter(m => m.requiresKey === "opencode")
      const anthropicModels = availableModels.filter(m => m.requiresKey === "anthropic")
      const openaiModels = availableModels.filter(m => m.requiresKey === "openai")
      const geminiModels = availableModels.filter(m => m.requiresKey === "gemini")
      const sections: { label: string; models: typeof availableModels }[] = []

      if (freeModels.length > 0) sections.push({ label: "Free", models: freeModels })
      if (opencodeModels.length > 0) sections.push({ label: "OpenCode", models: opencodeModels })
      if (anthropicModels.length > 0) sections.push({ label: "Anthropic", models: anthropicModels })
      if (openaiModels.length > 0) sections.push({ label: "OpenAI", models: openaiModels })
      if (geminiModels.length > 0) sections.push({ label: "Gemini", models: geminiModels })

      return sections
    }, [availableModels])

    const canSend = input.trim() && branch.status !== BRANCH_STATUS.RUNNING && branch.status !== BRANCH_STATUS.CREATING && branch.sandboxId
    const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)

    // Check if user can use Claude Code, Codex, Gemini, or Pi
    const canUseClaudeCode = hasClaudeCodeCredentials(credentials)
    const canUseCodex = hasCodexCredentials(credentials)
    const canUseGemini = hasGeminiCredentials(credentials)
    const canUsePi = hasPiCredentials(credentials)

    // Auto-resize textarea
    useEffect(() => {
      const textarea = (ref as React.RefObject<HTMLTextAreaElement>)?.current
      if (textarea) {
        textarea.style.height = "auto"
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px"
      }
    }, [input, ref])

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

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle slash command menu navigation
      if (slashMenuOpen && filteredCommands.length > 0) {
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
            onInputChange("")
            return
        }
      }

      // Normal enter to send
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSend()
      }
    }, [slashMenuOpen, filteredCommands, slashSelectedIndex, handleSlashCommandSelect, onInputChange, onSend])

    // Handle agent change - allow selection but open settings with highlight if missing credentials
    const handleAgentChange = useCallback((newAgent: Agent) => {
      // Always allow the agent change
      onAgentChange?.(newAgent)

      // If switching to Claude Code without credentials, open settings with highlight on subscription field
      if (newAgent === "claude-code" && !canUseClaudeCode) {
        onOpenSettingsWithHighlight?.("anthropicAuthToken")
      }
      // If switching to Codex without OpenAI API key, open settings with highlight on API key field
      else if (newAgent === "codex" && !canUseCodex) {
        onOpenSettingsWithHighlight?.("openaiApiKey")
      }
      // If switching to Gemini without Gemini API key, open settings with highlight on API key field
      else if (newAgent === "gemini" && !canUseGemini) {
        onOpenSettingsWithHighlight?.("geminiApiKey")
      }
      // If switching to Pi without any compatible API key, open settings with highlight on Anthropic API key field
      else if (newAgent === "pi" && !canUsePi) {
        onOpenSettingsWithHighlight?.("anthropicApiKey")
      }
    }, [onAgentChange, onOpenSettingsWithHighlight, canUseClaudeCode, canUseCodex, canUseGemini, canUsePi])

    // Handle model change - allow selection but open settings with highlight if missing credentials
    const handleModelChange = useCallback((model: ModelOption) => {
      // Always allow the model change
      onModelChange?.(model.value)

      // Check if user has credentials for this model (pass current agent for proper credential checking)
      if (!hasCredentialsForModel(model, credentials, currentAgent)) {
        // Determine which field to highlight based on model requirement
        const fieldMap: Record<string, string> = {
          openai: "openaiApiKey",
          anthropic: "anthropicApiKey",
          opencode: "opencodeApiKey",
          gemini: "geminiApiKey",
          pi: "anthropicApiKey",
        }
        const field = fieldMap[model.requiresKey ?? ""] ?? "anthropicApiKey"
        onOpenSettingsWithHighlight?.(field)
      }
    }, [onModelChange, onOpenSettingsWithHighlight, credentials, currentAgent])

    // Handle voice input toggle
    const handleVoiceInput = useCallback(() => {
      // Check if speech recognition is supported
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) {
        return
      }

      if (isListening) {
        // Stop listening
        recognitionRef.current?.stop()
        setIsListening(false)
        return
      }

      // Start listening
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = ''
        let interimTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript = transcript
          }
        }

        if (finalTranscript) {
          onInputChange(input + (input ? ' ' : '') + finalTranscript)
        }
      }

      recognition.onerror = () => {
        setIsListening(false)
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognitionRef.current = recognition
      recognition.start()
      setIsListening(true)
    }, [isListening, input, onInputChange])

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        recognitionRef.current?.stop()
      }
    }, [])

    return (
      <div
        className={cn(
          "shrink-0 border-t",
          isMobile ? "px-3 pt-3" : "px-3 py-3 sm:px-6",
          inRebaseConflict
            ? "border-t-red-700 bg-red-700/12 dark:border-t-red-600 dark:bg-red-950/45"
            : "border-border"
        )}
        style={isMobile ? { paddingBottom: 'calc(var(--safe-area-inset-bottom) + 0.75rem)' } : undefined}
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border px-3 py-2",
            inRebaseConflict
              ? "border-red-800/70 bg-background/95 focus-within:border-red-700 focus-within:ring-1 focus-within:ring-red-700/35 dark:border-red-700/80 dark:focus-within:border-red-600 dark:focus-within:ring-red-600/40"
              : "border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
          )}
        >
          {/* Textarea wrapper with slash command menu */}
          <div className="relative flex-1">
            {/* Slash Command Menu - positioned above the textarea */}
            <SlashCommandMenu
              input={input}
              open={slashMenuOpen && !!onSlashCommand}
              onSelect={handleSlashCommandSelect}
              onClose={() => {
                setSlashMenuOpen(false)
                setSlashSelectedIndex(0)
              }}
              selectedIndex={slashSelectedIndex}
              onSelectedIndexChange={setSlashSelectedIndex}
            />

            <textarea
              ref={ref}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                branch.status === BRANCH_STATUS.CREATING
                  ? "Type your first message while the sandbox is being set up..."
                  : !branch.sandboxId
                  ? "Sandbox not available"
                  : branch.status === BRANCH_STATUS.STOPPED
                  ? "Sandbox paused \u2014 will resume on send..."
                  : "Describe what you want the agent to do..."
              }
              rows={1}
              disabled={!isReady && branch.status !== BRANCH_STATUS.CREATING}
              className="w-full resize-none bg-transparent text-base sm:text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleVoiceInput}
                className={cn(
                  "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                  isListening
                    ? "bg-red-500/80 text-white hover:bg-red-500"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <Mic className={cn("h-4 w-4", isListening && "animate-pulse")} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isListening ? "Stop listening" : "Voice input"}
            </TooltipContent>
          </Tooltip>
          <button
            onClick={branch.status === BRANCH_STATUS.RUNNING ? onStop : onSend}
            disabled={branch.status === BRANCH_STATUS.RUNNING ? false : !canSend}
            className={cn(
              "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
              branch.status === BRANCH_STATUS.RUNNING
                ? "bg-red-500/80 text-white hover:bg-red-500"
                : canSend
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary text-muted-foreground"
            )}
          >
            {branch.status === BRANCH_STATUS.RUNNING ? (
              <span className="block h-3 w-3 rounded-sm bg-current" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          {/* Left: Agent Dropdown */}
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="group flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground cursor-pointer">
                <AgentIcon agent={currentAgent} className="h-2.5 w-2.5 shrink-0" />
                <span>{agentLabels[currentAgent]}</span>
                <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={4} className="min-w-[160px] rounded-lg border border-border/60 py-0.5 shadow-md">
                {(Object.keys(agentLabels) as Agent[]).map((agent) => (
                  <DropdownMenuItem
                    key={agent}
                    onClick={() => handleAgentChange(agent)}
                    className="flex items-center justify-between py-1.5 text-[11px] cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <AgentIcon agent={agent} className="h-3 w-3 shrink-0" />
                      {agentLabels[agent]}
                    </span>
                    {agent === currentAgent && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right: Model Combobox */}
          <Popover open={modelOpen} onOpenChange={setModelOpen}>
              <PopoverTrigger className="group flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground cursor-pointer">
                <Sparkles className="h-2.5 w-2.5 shrink-0" />
                <span>{getModelLabel(currentAgent, currentModel)}</span>
                <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={4} className="w-[220px] p-0">
                <Command>
                  <CommandInput placeholder="Search models..." className="h-8 text-[11px]" />
                  <CommandList>
                    <CommandEmpty className="py-3 px-3 text-[11px] text-center">
                      {availableModels.length === 0 ? (
                        <button
                          onClick={() => {
                            setModelOpen(false)
                            onOpenSettings?.()
                          }}
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Configure API keys in Settings
                        </button>
                      ) : (
                        "No models found."
                      )}
                    </CommandEmpty>
                    {modelSections.map((section) => (
                      <CommandGroup key={section.label} heading={section.label}>
                        {section.models.map((model) => (
                          <CommandItem
                            key={model.value}
                            value={model.label}
                            onSelect={() => {
                              handleModelChange(model)
                              setModelOpen(false)
                            }}
                            className="flex items-center justify-between text-[11px] cursor-pointer"
                          >
                            {model.label}
                            {model.value === currentModel && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
        </div>
      </div>
    )
  }
)
