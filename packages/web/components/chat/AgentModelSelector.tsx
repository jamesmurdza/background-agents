"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { ChevronDown, Cpu, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useModals } from "@/lib/contexts"
import type { Agent, ModelOption, CredentialFlags, Chat } from "@/lib/types"
import { getAgentModels, getFreeModelForAgent, agentLabels, getModelLabel, hasCredentialsForModel, agentHasFreeUsage, agentIsReady, agentSharedPoolExhausted, agentUsesSharedPool, resolveModelForAgent, sharedPoolProviderForModel, formatTokenRate, ALL_AGENTS } from "@/lib/types"
import { creditTier, discountDivisorFor } from "@/lib/server/credits"
import { fmtCreditAmount } from "@/lib/format"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { AgentIcon } from "../icons/agent-icons"
import { MobileSelect } from "../ui/MobileBottomSheet"
import type { HighlightKey } from "../modals/SettingsModal"
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

// =============================================================================
// AgentModelSelector - Dropdown selectors for agent and model
// =============================================================================

interface AgentModelSelectorProps {
  chat: Chat | null
  credentialFlags: CredentialFlags
  currentAgent: Agent
  currentModel: string
  onUpdateChat?: (updates: Partial<Chat>) => void
  showClaudeLimitDialog: () => void
  isMobile: boolean
  /** Called when a dropdown opens, so parent can close other dropdowns */
  onDropdownOpen?: () => void
  /** When true, close all dropdowns (controlled by parent) */
  closeDropdowns?: boolean
}

// Env override so Eliza can be forced on in tests/CI regardless of the stored
// user setting (which defaults to off). Set NEXT_PUBLIC_ENABLE_ELIZA=true.
const ELIZA_ENV_OVERRIDE = process.env.NEXT_PUBLIC_ENABLE_ELIZA === "true"

/**
 * Picker status for an agent's readiness dot:
 *  - "ready"     → green dot (free usage available or the user is set up)
 *  - "low"       → yellow dot (shared-pool agent, balance nearly spent)
 *  - "depleted"  → red dot (shared-pool agent, balance spent — the server will
 *                  refuse the next send)
 *  - null        → no dot (needs setup)
 * Single source of truth for the dot color and its tooltip/description text.
 *
 * Red is driven by `agentSharedPoolExhausted` — the flag the server sets from
 * the same comparison its send gate makes (lib/db/usage-limit) — rather than by
 * the balance passed in, so a rounding difference in the float can never leave
 * the dot green on a send the server is about to refuse. `balanceUsd` decides
 * only the advisory yellow, which has no server counterpart.
 *
 * An exhausted shared pool never turns the dot red for an agent that also has
 * an always-free, no-key model (OpenCode's opencode/big-pickle & co., like
 * Kilo's free auto-router) — that route never touches the balance, so the
 * agent stays fully usable and the dot stays green.
 */
type AgentStatusTone = "ready" | "low" | "depleted"

function getAgentStatus(
  agent: Agent,
  flags: CredentialFlags,
  balanceUsd: number | null | undefined
): { tone: AgentStatusTone; label: string } | null {
  if (agentSharedPoolExhausted(agent, flags) && !getFreeModelForAgent(agent)) {
    return { tone: "depleted", label: "Out of credits" }
  }
  if (agentUsesSharedPool(agent, flags) && creditTier(balanceUsd) === "low") {
    return { tone: "low", label: `Credits running low — ${fmtCreditAmount(balanceUsd!)} left` }
  }
  if (agentIsReady(agent, flags)) {
    return {
      tone: "ready",
      label: agentHasFreeUsage(agent, flags) ? "Free usage available" : "Ready to use",
    }
  }
  return null
}

/** Tailwind background for each dot tone. */
const DOT_CLASS: Record<AgentStatusTone, string> = {
  ready: "bg-green-500",
  low: "bg-yellow-500",
  depleted: "bg-red-500",
}

/**
 * The price to show beside a model, or null when it has no published rate.
 *
 * A shared-pool run is charged its list rate divided by the provider's divisor
 * (see DISCOUNT_DIVISOR in lib/server/credits), so the picker divides too and
 * shows what the user actually pays. A BYOK run never touches the balance, so
 * it keeps the list rate the provider quotes.
 */
function getModelPrice(
  agent: Agent,
  model: ModelOption,
  flags: CredentialFlags
): string | null {
  if (model.priceUsdPerM === undefined) return null
  const provider = sharedPoolProviderForModel(agent, model.value, flags)
  const divisor = provider ? discountDivisorFor(provider) : 1
  return formatTokenRate(model.priceUsdPerM / divisor)
}

export function AgentModelSelector({
  chat,
  credentialFlags,
  currentAgent,
  currentModel,
  onUpdateChat,
  showClaudeLimitDialog,
  isMobile,
  onDropdownOpen,
  closeDropdowns,
}: AgentModelSelectorProps) {
  const modals = useModals()

  // User's custom endpoints — merged into each agent's model list by name.
  const { data: settingsData } = useSettingsQuery()
  const endpoints = settingsData?.customEndpoints
  // Null for anyone the balance doesn't gate (unlimited plan, own keys
  // everywhere, logged out) — those users never get a credit-coloured dot.
  const creditBalanceUsd = settingsData?.creditBalanceUsd ?? null

  // Eliza (a deterministic test agent) is hidden from the picker unless the user
  // enables it in the Developer settings, or the env override is set (tests/CI).
  const elizaEnabled = (settingsData?.settings?.elizaEnabled ?? false) || ELIZA_ENV_OVERRIDE
  const agents = useMemo(
    () => ALL_AGENTS.filter((a) => a !== "eliza" || elizaEnabled),
    [elizaEnabled]
  )

  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [showAgentSheet, setShowAgentSheet] = useState(false)
  const [showModelSheet, setShowModelSheet] = useState(false)
  const [search, setSearch] = useState("")

  const availableModels = getAgentModels(currentAgent, endpoints)
  const selectedModelConfig = availableModels.find(m => m.value === currentModel)
  const hasRequiredCredentials = selectedModelConfig
    ? hasCredentialsForModel(selectedModelConfig, credentialFlags, currentAgent)
    : true

  // Close dropdowns when parent requests it
  useEffect(() => {
    if (closeDropdowns) {
      setShowAgentDropdown(false)
      setShowModelDropdown(false)
    }
  }, [closeDropdowns])

  // Close dropdowns when clicking outside (desktop only)
  useEffect(() => {
    if (isMobile) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowAgentDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMobile])

  const handleAgentChange = useCallback((agent: Agent) => {
    setShowAgentDropdown(false)
    setShowAgentSheet(false)

    // Block switching to any agent whose only route is a shared pool the user
    // has no balance left for. agentSharedPoolExhausted is per-agent, so an
    // agent the user has their own key for stays selectable at zero balance —
    // and so does an agent with an always-free, no-key model (OpenCode), whose
    // free tier never touches the balance.
    if (agentSharedPoolExhausted(agent, credentialFlags) && !getFreeModelForAgent(agent)) {
      showClaudeLimitDialog()
      return
    }

    // Update chat's agent if possible
    if (chat && onUpdateChat) {
      // Remember the current selection so we can revert if the user opens
      // Settings for a required key and then closes without entering one.
      const prevAgent = currentAgent
      const prevModel = currentModel
      // Pick a model that works right now for the agent we're switching to:
      // honor the user's saved default model when it belongs to this agent and
      // is usable, otherwise the first free/configured model (see resolver).
      const models = getAgentModels(agent, endpoints)
      const newModel = resolveModelForAgent(agent, credentialFlags, settingsData?.settings?.defaultModel, endpoints)
      onUpdateChat({ agent, model: newModel })

      // Check if the new model requires credentials we don't have
      const newModelConfig = models.find(m => m.value === newModel)
      if (newModelConfig && !hasCredentialsForModel(newModelConfig, credentialFlags, agent)) {
        // Open settings with the required key highlighted. If the user dismisses
        // it without entering a key, restore the previous agent/model.
        const requiredKey = newModelConfig.requiresKey
        if (requiredKey && requiredKey !== "none") {
          modals.openSettings(requiredKey as HighlightKey, () =>
            onUpdateChat({ agent: prevAgent, model: prevModel })
          )
        }
      }
    }
  }, [chat, currentAgent, currentModel, credentialFlags, endpoints, settingsData, onUpdateChat, showClaudeLimitDialog, modals])

  const handleModelChange = useCallback((model: string) => {
    setShowModelDropdown(false)
    setShowModelSheet(false)
    if (chat && onUpdateChat) {
      const prevModel = currentModel
      onUpdateChat({ model })

      // Check if the new model requires credentials we don't have
      const newModelConfig = availableModels.find(m => m.value === model)
      if (newModelConfig && !hasCredentialsForModel(newModelConfig, credentialFlags, currentAgent)) {
        // Open settings with the required key highlighted. If the user dismisses
        // it without entering a key, restore the previous model.
        const requiredKey = newModelConfig.requiresKey
        if (requiredKey && requiredKey !== "none") {
          modals.openSettings(requiredKey as HighlightKey, () =>
            onUpdateChat({ model: prevModel })
          )
        }
      }
    }
  }, [chat, availableModels, credentialFlags, currentAgent, currentModel, onUpdateChat, modals])

  // Determine which section heading a model belongs to
  const getModelSection = useCallback((model: ModelOption): string => {
    if (model.requiresKey === "none") return "Free"
    if (model.value.startsWith("endpoint:")) return "Custom Endpoints"

    if (currentAgent === "opencode") {
      if (model.value.startsWith("opencode-go/")) return "OpenCode Go"
      if (model.value.startsWith("opencode/")) return "OpenCode Zen"
      if (model.value.startsWith("anthropic/")) return "Anthropic Direct"
      if (model.value.startsWith("openai/")) return "OpenAI Direct"
      return "OpenCode"
    }

    if (currentAgent === "kilo") {
      if (model.value.includes("/anthropic/")) return "Anthropic"
      if (model.value.includes("/openai/")) return "OpenAI"
      if (model.value.includes("/google/")) return "Google"
      if (model.value.includes("/deepseek/")) return "DeepSeek"
      return "Other Models"
    }

    switch (model.requiresKey) {
      case "anthropic": return "Anthropic"
      case "openai": return "OpenAI"
      case "gemini": return "Google"
      case "github": return "GitHub"
      case "kimi": return "Moonshot"
      case "factory": return "Factory"
      case "kilo": return "Kilo"
      case "opencode": return "OpenCode"
      default: return "Other"
    }
  }, [currentAgent])

  // Filter, group, and sort models: ready sections first, locked sections last
  const modelSections = useMemo(() => {
    let models = availableModels
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      models = availableModels.filter((m) =>
        m.label.toLowerCase().includes(searchLower)
      )
    }

    const readySections = new Map<string, ModelOption[]>()
    const lockedSections = new Map<string, ModelOption[]>()
    const readyOrder: string[] = []
    const lockedOrder: string[] = []

    for (const model of models) {
      const hasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
      const isLocked = model.requiresKey !== "none" && !hasCredentials
      const targetMap = isLocked ? lockedSections : readySections
      const targetOrder = isLocked ? lockedOrder : readyOrder
      const section = getModelSection(model)

      if (!targetMap.has(section)) {
        targetMap.set(section, [])
        targetOrder.push(section)
      }
      targetMap.get(section)!.push(model)
    }

    // The same provider label can appear in both groups (e.g. Google: Flash is
    // available on the shared pool while Pro is locked), so the render key must
    // fold in ready/locked to stay unique — the label alone is not.
    const result: { key: string; label: string; models: ModelOption[] }[] = []
    for (const label of readyOrder) {
      result.push({ key: `ready:${label}`, label, models: readySections.get(label)! })
    }
    for (const label of lockedOrder) {
      result.push({ key: `locked:${label}`, label, models: lockedSections.get(label)! })
    }
    return result
  }, [availableModels, search, credentialFlags, currentAgent, getModelSection])

  // Prepare agent options for mobile bottom sheet
  const agentOptions = agents.map(agent => ({
    value: agent,
    label: agentLabels[agent],
    icon: <AgentIcon agent={agent} className="h-5 w-5" />,
    // Surface the agent's status: ready to use (free or configured), a balance
    // running low, or a spent one with nothing else to fall back on.
    description: getAgentStatus(agent, credentialFlags, creditBalanceUsd)?.label,
  }))

  // Prepare model options for mobile bottom sheet
  const modelOptions = availableModels.map((model: ModelOption) => {
    const modelHasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
    const needsKey = model.requiresKey !== "none" && !modelHasCredentials
    return {
      value: model.value,
      label: model.label,
      description: needsKey ? "Requires API key" : undefined,
      priceLabel: getModelPrice(currentAgent, model, credentialFlags) ?? undefined,
      icon: needsKey ? <Lock className="h-5 w-5 text-muted-foreground" /> : undefined,
    }
  })

  if (isMobile) {
    return (
      <>
        {/* Agent selector - Mobile */}
        <button
          onClick={() => setShowAgentSheet(true)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title={agentLabels[currentAgent]}
        >
          <AgentIcon agent={currentAgent} className="h-4 w-4" />
          <span className="hidden @[18rem]/row2:inline">{agentLabels[currentAgent]}</span>
          <ChevronDown className="h-4 w-4 hidden @[18rem]/row2:block" />
        </button>

        {/* Model selector - Mobile */}
        <button
          onClick={() => setShowModelSheet(true)}
          className={cn(
            "flex items-center gap-1 text-sm transition-colors cursor-pointer",
            !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
          )}
          title={getModelLabel(currentAgent, currentModel, endpoints)}
        >
          {!hasRequiredCredentials && <Lock className="h-4 w-4" />}
          <Cpu className="h-4 w-4 @[18rem]/row2:hidden" />
          <span className="hidden @[18rem]/row2:inline">{getModelLabel(currentAgent, currentModel, endpoints)}</span>
          <ChevronDown className="h-4 w-4 hidden @[18rem]/row2:block" />
        </button>

        {/* Mobile Bottom Sheets */}
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
    )
  }

  // Desktop dropdowns
  return (
    <>
      {/* Agent selector - Desktop */}
      <div className="relative" data-dropdown>
        <button
          onClick={(e) => {
            e.stopPropagation()
            const opening = !showAgentDropdown
            setShowAgentDropdown(opening)
            setShowModelDropdown(false)
            if (opening) onDropdownOpen?.()
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer"
          title={agentLabels[currentAgent]}
        >
          <AgentIcon agent={currentAgent} className="h-3.5 w-3.5" />
          <span className="hidden @[32rem]:inline">{agentLabels[currentAgent]}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {showAgentDropdown && (
          <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-48">
            {agents.map((agent) => {
              const status = getAgentStatus(agent, credentialFlags, creditBalanceUsd)
              return (
                <button
                  key={agent}
                  onClick={() => handleAgentChange(agent)}
                  className={cn(
                    "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                    agent === currentAgent && "bg-accent"
                  )}
                >
                  <AgentIcon agent={agent} className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{agentLabels[agent]}</span>
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      status ? DOT_CLASS[status.tone] : "bg-transparent"
                    )}
                    title={status?.label}
                    aria-label={status?.label}
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Model selector - Desktop */}
      <Popover open={showModelDropdown} onOpenChange={(open) => {
        setShowModelDropdown(open)
        if (open) {
          setShowAgentDropdown(false)
          onDropdownOpen?.()
        } else {
          setSearch("")
        }
      }}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1 text-sm transition-colors cursor-pointer",
              !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
            )}
            title={getModelLabel(currentAgent, currentModel, endpoints)}
          >
            {!hasRequiredCredentials && <Lock className="h-3.5 w-3.5" />}
            <Cpu className="h-3.5 w-3.5 @[32rem]:hidden" />
            <span className="hidden @[32rem]:inline">{getModelLabel(currentAgent, currentModel, endpoints)}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-0"
          align="end"
          side="top"
          sideOffset={4}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search models..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No models found</CommandEmpty>
              {modelSections.map((section) => (
                <CommandGroup key={section.key} heading={section.label}>
                  {section.models.map((model) => {
                    const modelHasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
                    const needsKey = model.requiresKey !== "none" && !modelHasCredentials
                    const priceLabel = getModelPrice(currentAgent, model, credentialFlags)
                    return (
                      <CommandItem
                        key={model.value}
                        value={model.value}
                        onSelect={() => handleModelChange(model.value)}
                        className={cn(
                          "flex items-center justify-between cursor-pointer",
                          model.value === currentModel && "bg-accent"
                        )}
                      >
                        <span className="truncate">{model.label}</span>
                        <span className="flex items-center gap-1.5 ml-auto shrink-0">
                          {priceLabel && (
                            <span className="text-xs text-muted-foreground">{priceLabel}</span>
                          )}
                          {needsKey && (
                            <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  )
}
