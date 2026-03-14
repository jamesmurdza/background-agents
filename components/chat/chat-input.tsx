"use client"

import { cn } from "@/lib/utils"
import type { Agent, Branch, UserCredentialFlags } from "@/lib/types"
import { agentLabels, getModelLabel, defaultAgentModel, getAvailableModels, hasClaudeCodeCredentials } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"
import { Send, Terminal, ChevronDown, Sparkles, Check, Lock } from "lucide-react"
import { forwardRef, useEffect, useCallback, useState, useMemo } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { ModelOption } from "@/lib/types"

// ============================================================================
// Model Combobox Component - Searchable model selector
// ============================================================================

interface ModelComboboxProps {
  availableModels: ModelOption[]
  currentModel: string
  currentAgent: Agent
  onModelChange?: (model: string) => void
  onOpenSettings?: () => void
}

function ModelCombobox({
  availableModels,
  currentModel,
  currentAgent,
  onModelChange,
  onOpenSettings,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)

  // Group models by requirement
  const modelGroups = useMemo(() => {
    const freeModels = availableModels.filter(m => m.requiresKey === "none")
    const anthropicModels = availableModels.filter(m => m.requiresKey === "anthropic")
    const openaiModels = availableModels.filter(m => m.requiresKey === "openai")
    const groups: { label: string; models: ModelOption[] }[] = []

    if (freeModels.length > 0) groups.push({ label: "Free", models: freeModels })
    if (anthropicModels.length > 0) groups.push({ label: "Anthropic", models: anthropicModels })
    if (openaiModels.length > 0) groups.push({ label: "OpenAI", models: openaiModels })

    return groups
  }, [availableModels])

  const handleSelect = useCallback((modelValue: string) => {
    onModelChange?.(modelValue)
    setOpen(false)
  }, [onModelChange])

  if (availableModels.length === 0) {
    return (
      <button
        onClick={() => onOpenSettings?.()}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
      >
        <Sparkles className="h-2.5 w-2.5 shrink-0" />
        <span>Configure API keys</span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="group flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground cursor-pointer"
        >
          <Sparkles className="h-2.5 w-2.5 shrink-0" />
          <span>{getModelLabel(currentAgent, currentModel)}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[220px] p-0 rounded-lg border border-border/60 shadow-md"
      >
        <Command>
          <CommandInput placeholder="Search models..." className="h-8 text-[11px]" />
          <CommandList className="max-h-[250px]">
            <CommandEmpty className="py-3 text-[11px] text-center">
              No models found.
            </CommandEmpty>
            {modelGroups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.models.map((model) => (
                  <CommandItem
                    key={model.value}
                    value={`${model.label} ${model.value}`}
                    onSelect={() => handleSelect(model.value)}
                    className="flex items-center justify-between py-1.5 text-[11px] cursor-pointer"
                  >
                    <span>{model.label}</span>
                    {model.value === currentModel && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

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
  credentials?: UserCredentialFlags | null
  isMobile?: boolean
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { branch, input, onInputChange, onSend, onStop, onAgentChange, onModelChange, onOpenSettings, credentials, isMobile },
    ref
  ) {
    // Normalize agent value (handle legacy "claude" value from database)
    const rawAgent = branch.agent as string | undefined
    const normalizedAgent = (!rawAgent || rawAgent === "claude") ? "claude-code" : rawAgent
    const currentAgent = normalizedAgent as Agent
    const currentModel = branch.model || defaultAgentModel[currentAgent]

    // Filter models based on available credentials
    const availableModels = getAvailableModels(currentAgent, credentials)

    const canSend = input.trim() && branch.status !== BRANCH_STATUS.RUNNING && branch.status !== BRANCH_STATUS.CREATING && branch.sandboxId
    const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)

    // Check if user can use Claude Code
    const canUseClaudeCode = hasClaudeCodeCredentials(credentials)

    // Auto-resize textarea
    useEffect(() => {
      const textarea = (ref as React.RefObject<HTMLTextAreaElement>)?.current
      if (textarea) {
        textarea.style.height = "auto"
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px"
      }
    }, [input, ref])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSend()
      }
    }, [onSend])

    // Handle agent change with credential check
    const handleAgentChange = useCallback((newAgent: Agent) => {
      if (newAgent === "claude-code" && !canUseClaudeCode) {
        // Open settings to configure Claude credentials
        onOpenSettings?.()
        return
      }
      onAgentChange?.(newAgent)
    }, [onAgentChange, onOpenSettings, canUseClaudeCode])

    return (
      <div
        className={cn(
          "shrink-0 border-t border-border",
          isMobile ? "px-3 pt-3" : "px-3 py-3 sm:px-6"
        )}
        style={isMobile ? { paddingBottom: 'calc(var(--safe-area-inset-bottom) + 0.75rem)' } : undefined}
      >
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
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
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
          />
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
          {/* Agent Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="group flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground cursor-pointer">
              <Terminal className="h-2.5 w-2.5 shrink-0" />
              <span>{agentLabels[currentAgent]}</span>
              <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="min-w-[160px] rounded-lg border border-border/60 py-0.5 shadow-md">
              {(Object.keys(agentLabels) as Agent[]).map((agent) => {
                const isLocked = agent === "claude-code" && !canUseClaudeCode
                return (
                  <DropdownMenuItem
                    key={agent}
                    onClick={() => handleAgentChange(agent)}
                    className="flex items-center justify-between py-1.5 text-[11px] cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      {agentLabels[agent]}
                      {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </span>
                    {agent === currentAgent && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Model Combobox */}
          <ModelCombobox
            availableModels={availableModels}
            currentModel={currentModel}
            currentAgent={currentAgent}
            onModelChange={onModelChange}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    )
  }
)
