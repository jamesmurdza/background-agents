"use client"

import { cn } from "@/lib/utils"
import { ChevronDown, Lock, Terminal, Code, Box, Sparkles } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import {
  type ProviderName,
  type ModelConfig,
  AGENT_CONFIGS,
} from "@/lib/types"
import { AGENT_PROVIDER, CREDENTIAL_TYPE } from "@/lib/constants"

// Icon mapping for each provider
const PROVIDER_ICONS: Record<ProviderName, React.ReactNode> = {
  [AGENT_PROVIDER.CLAUDE]: <Terminal className="h-3 w-3" />,
  [AGENT_PROVIDER.CODEX]: <Code className="h-3 w-3" />,
  [AGENT_PROVIDER.OPENCODE]: <Box className="h-3 w-3" />,
}

interface AgentSelectorProps {
  selectedAgent: ProviderName
  selectedModel?: string
  onAgentChange: (agent: ProviderName) => void
  onModelChange: (model: string) => void
  disabled?: boolean
  credentials: {
    hasAnthropicApiKey?: boolean
    hasAnthropicAuthToken?: boolean
    hasOpenaiApiKey?: boolean
  }
}

// Check if a provider is enabled based on credentials
function isProviderEnabled(
  provider: ProviderName,
  credentials: AgentSelectorProps["credentials"]
): boolean {
  switch (provider) {
    case AGENT_PROVIDER.CLAUDE:
      return !!(credentials.hasAnthropicApiKey || credentials.hasAnthropicAuthToken)
    case AGENT_PROVIDER.CODEX:
      return !!credentials.hasOpenaiApiKey
    case AGENT_PROVIDER.OPENCODE:
      // OpenCode is always enabled because it has free models
      return true
    default:
      return false
  }
}

// Check if a model is available based on credentials
function isModelAvailable(
  model: ModelConfig,
  credentials: AgentSelectorProps["credentials"]
): boolean {
  switch (model.requiresKey) {
    case CREDENTIAL_TYPE.ANTHROPIC:
      return !!(credentials.hasAnthropicApiKey || credentials.hasAnthropicAuthToken)
    case CREDENTIAL_TYPE.OPENAI:
      return !!credentials.hasOpenaiApiKey
    case CREDENTIAL_TYPE.NONE:
      return true
    default:
      return false
  }
}

export function AgentSelector({
  selectedAgent,
  selectedModel,
  onAgentChange,
  onModelChange,
  disabled,
  credentials,
}: AgentSelectorProps) {
  const [agentOpen, setAgentOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const agentRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)

  const config = AGENT_CONFIGS[selectedAgent]
  const currentModel = config.models.find((m) => m.id === selectedModel) || config.models[0]

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) {
        setAgentOpen(false)
      }
      if (modelRef.current && !modelRef.current.contains(event.target as Node)) {
        setModelOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className="flex items-center gap-1">
      {/* Agent dropdown */}
      <div className="relative" ref={agentRef}>
        <button
          type="button"
          onClick={() => !disabled && setAgentOpen(!agentOpen)}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground rounded-md transition-colors",
            !disabled && "hover:text-foreground hover:bg-accent cursor-pointer",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {PROVIDER_ICONS[selectedAgent]}
          <span>{config.label}</span>
          <ChevronDown className={cn("h-3 w-3 transition-transform", agentOpen && "rotate-180")} />
        </button>

        {agentOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-48 rounded-md border border-border bg-popover p-1 shadow-md z-50">
            {(Object.keys(AGENT_CONFIGS) as ProviderName[]).map((agent) => {
              const agentConfig = AGENT_CONFIGS[agent]
              const enabled = isProviderEnabled(agent, credentials)
              return (
                <button
                  key={agent}
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    if (enabled) {
                      onAgentChange(agent)
                      setAgentOpen(false)
                    }
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded transition-colors",
                    enabled ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed",
                    agent === selectedAgent && "bg-accent"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {PROVIDER_ICONS[agent]}
                    <span>{agentConfig.label}</span>
                  </div>
                  {!enabled && <Lock className="h-3 w-3 text-muted-foreground" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <span className="text-muted-foreground/30">|</span>

      {/* Model dropdown */}
      <div className="relative" ref={modelRef}>
        <button
          type="button"
          onClick={() => !disabled && setModelOpen(!modelOpen)}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground rounded-md transition-colors",
            !disabled && "hover:text-foreground hover:bg-accent cursor-pointer",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <span>{currentModel?.label || "Select model"}</span>
          <ChevronDown className={cn("h-3 w-3 transition-transform", modelOpen && "rotate-180")} />
        </button>

        {modelOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md z-50">
            {config.models.map((model) => {
              const available = isModelAvailable(model, credentials)
              return (
                <button
                  key={model.id}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    if (available) {
                      onModelChange(model.id)
                      setModelOpen(false)
                    }
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 text-xs rounded transition-colors",
                    available ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed",
                    model.id === selectedModel && "bg-accent"
                  )}
                >
                  <span>{model.label}</span>
                  <div className="flex items-center gap-1.5">
                    {model.requiresKey === CREDENTIAL_TYPE.NONE && (
                      <span className="flex items-center gap-0.5 text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                        <Sparkles className="h-2.5 w-2.5" />
                        Free
                      </span>
                    )}
                    {!available && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
