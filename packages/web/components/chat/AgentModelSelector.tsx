"use client"

import { ChevronDown, Key, Cpu } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Agent, ModelOption, CredentialFlags } from "@/lib/types"
import { agentModels, agentLabels, getModelLabel, hasCredentialsForModel } from "@/lib/types"
import { AgentIcon } from "../icons/agent-icons"
import { MobileSelect } from "../ui/MobileBottomSheet"

interface AgentModelSelectorProps {
  currentAgent: Agent
  currentModel: string
  credentialFlags: CredentialFlags
  onAgentChange: (agent: Agent) => void
  onModelChange: (model: string) => void
  isMobile?: boolean
  // Desktop dropdown states (controlled from parent)
  showAgentDropdown: boolean
  setShowAgentDropdown: (show: boolean) => void
  showModelDropdown: boolean
  setShowModelDropdown: (show: boolean) => void
  // Mobile sheet states
  showAgentSheet: boolean
  setShowAgentSheet: (show: boolean) => void
  showModelSheet: boolean
  setShowModelSheet: (show: boolean) => void
}

const agents: Agent[] = ["claude-code", "opencode", "codex", "gemini", "goose", "pi", "eliza"]

export function AgentModelSelector({
  currentAgent,
  currentModel,
  credentialFlags,
  onAgentChange,
  onModelChange,
  isMobile = false,
  showAgentDropdown,
  setShowAgentDropdown,
  showModelDropdown,
  setShowModelDropdown,
  showAgentSheet,
  setShowAgentSheet,
  showModelSheet,
  setShowModelSheet,
}: AgentModelSelectorProps) {
  const availableModels = agentModels[currentAgent] ?? []
  const selectedModelConfig = availableModels.find(m => m.value === currentModel)
  const hasRequiredCredentials = selectedModelConfig
    ? hasCredentialsForModel(selectedModelConfig, credentialFlags, currentAgent)
    : true

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

  return (
    <>
      {/* Agent selector */}
      {isMobile ? (
        // Mobile: Use bottom sheet
        <button
          onClick={() => setShowAgentSheet(true)}
          className="flex items-center gap-1 text-sm py-1 px-2 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer"
          title={agentLabels[currentAgent]}
        >
          <AgentIcon agent={currentAgent} className="h-4 w-4" />
          <span className="hidden @[18rem]/row2:inline">{agentLabels[currentAgent]}</span>
          <ChevronDown className="h-4 w-4 hidden @[18rem]/row2:block" />
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
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground transition-colors cursor-pointer"
            title={agentLabels[currentAgent]}
          >
            <AgentIcon agent={currentAgent} className="h-3.5 w-3.5" />
            <span className="hidden @[32rem]:inline">{agentLabels[currentAgent]}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showAgentDropdown && (
            <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40">
              {agents.map((agent) => (
                <button
                  key={agent}
                  onClick={() => onAgentChange(agent)}
                  className={cn(
                    "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
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
            "flex items-center gap-1 text-sm py-1 px-2 rounded-md hover:bg-accent/50 transition-colors cursor-pointer",
            !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
          )}
          title={getModelLabel(currentAgent, currentModel)}
        >
          {!hasRequiredCredentials && <Key className="h-4 w-4" />}
          <Cpu className="h-4 w-4 @[18rem]/row2:hidden" />
          <span className="hidden @[18rem]/row2:inline">{getModelLabel(currentAgent, currentModel)}</span>
          <ChevronDown className="h-4 w-4 hidden @[18rem]/row2:block" />
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
              "flex items-center gap-1 text-sm transition-colors cursor-pointer",
              !hasRequiredCredentials ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground"
            )}
            title={getModelLabel(currentAgent, currentModel)}
          >
            {!hasRequiredCredentials && <Key className="h-3.5 w-3.5" />}
            <Cpu className="h-3.5 w-3.5 @[32rem]:hidden" />
            <span className="hidden @[32rem]:inline">{getModelLabel(currentAgent, currentModel)}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showModelDropdown && (
            <div className="absolute bottom-full right-0 mb-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52">
              {availableModels.map((model: ModelOption) => {
                const modelHasCredentials = hasCredentialsForModel(model, credentialFlags, currentAgent)
                const needsKey = model.requiresKey !== "none" && !modelHasCredentials
                return (
                  <button
                    key={model.value}
                    onClick={() => onModelChange(model.value)}
                    className={cn(
                      "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer",
                      model.value === currentModel && "bg-accent"
                    )}
                  >
                    <span>{model.label}</span>
                    {needsKey && <Key className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Mobile Bottom Sheets */}
      {isMobile && (
        <>
          <MobileSelect
            open={showAgentSheet}
            onClose={() => setShowAgentSheet(false)}
            title="Select Agent"
            options={agentOptions}
            value={currentAgent}
            onChange={(value) => onAgentChange(value as Agent)}
          />
          <MobileSelect
            open={showModelSheet}
            onClose={() => setShowModelSheet(false)}
            title="Select Model"
            options={modelOptions}
            value={currentModel}
            onChange={onModelChange}
          />
        </>
      )}
    </>
  )
}
