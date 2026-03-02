"use client"

import { cn } from "@/lib/utils"
import { X, Key, Github, Terminal } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"

const agents = [
  { id: "claude-code", label: "Claude Code", icon: Terminal },
  { id: "codex", label: "Codex", icon: Terminal },
  { id: "opencode", label: "OpenCode", icon: Terminal },
  { id: "default", label: "Default", icon: Key },
] as const

const apiKeyFields: Record<string, { label: string; placeholder: string }[]> = {
  default: [
    { label: "Anthropic API Key", placeholder: "sk-ant-..." },
    { label: "OpenAI API Key", placeholder: "sk-..." },
    { label: "OpenCode API Key", placeholder: "oc-..." },
  ],
  "claude-code": [
    { label: "Anthropic API Key", placeholder: "sk-ant-..." },
  ],
  codex: [
    { label: "OpenAI API Key", placeholder: "sk-..." },
  ],
  opencode: [
    { label: "OpenCode API Key", placeholder: "oc-..." },
  ],
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeAgent, setActiveAgent] = useState("claude-code")

  if (!open) return null

  const fields = apiKeyFields[activeAgent] ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* GitHub PAT */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Github className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">GitHub Personal Access Token</span>
          </div>
          <Input
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">Required for creating branches and pull requests</p>
        </div>

        {/* Agent API Keys */}
        <div className="flex h-[220px] min-h-0">
          {/* Agent nav */}
          <div className="flex w-[140px] shrink-0 flex-col border-r border-border bg-background py-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setActiveAgent(agent.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-4 py-2 text-xs transition-colors text-left",
                  activeAgent === agent.id
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <agent.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{agent.label}</span>
              </button>
            ))}
          </div>

          {/* Key fields */}
          <div className="flex flex-1 flex-col gap-4 p-5">
            <p className="text-[11px] text-muted-foreground">
              {activeAgent === "default"
                ? "API keys configured here are used as fallback for all agents."
                : `API key for ${agents.find((a) => a.id === activeAgent)?.label}. Overrides the default key.`}
            </p>
            {fields.map((field) => (
              <div key={field.label} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">{field.label}</label>
                <Input
                  type="password"
                  placeholder={field.placeholder}
                  className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
