"use client"

import { cn } from "@/lib/utils"
import { X, Terminal, Copy, Check, Loader2, Clock, Code } from "lucide-react"
import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import type { AnthropicAuthType } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  credentials?: {
    anthropicAuthType: string
    hasAnthropicApiKey: boolean
    hasAnthropicAuthToken: boolean
    hasOpenaiApiKey: boolean
    sandboxAutoStopInterval?: number
  } | null
  onCredentialsUpdate: () => void
}

export function SettingsModal({ open, onClose, credentials, onCredentialsUpdate }: SettingsModalProps) {
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [anthropicAuthType, setAnthropicAuthType] = useState<AnthropicAuthType>("api-key")
  const [anthropicAuthToken, setAnthropicAuthToken] = useState("")
  const [openaiApiKey, setOpenaiApiKey] = useState("")
  const [sandboxAutoStopInterval, setSandboxAutoStopInterval] = useState(5)
  const [initialAutoStopInterval, setInitialAutoStopInterval] = useState(5)
  const [copied, setCopied] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ message: string; isError: boolean } | null>(null)

  // Sync form state when modal opens
  useEffect(() => {
    if (open) {
      // Set auth type from credentials but clear input fields
      setAnthropicAuthType((credentials?.anthropicAuthType as AnthropicAuthType) ?? "api-key")
      setAnthropicApiKey("")
      setAnthropicAuthToken("")
      setOpenaiApiKey("")
      const interval = credentials?.sandboxAutoStopInterval ?? 5
      setSandboxAutoStopInterval(interval)
      setInitialAutoStopInterval(interval)
      setSaveStatus(null)
    }
  }, [open, credentials])

  if (!open) return null

  async function handleSave() {
    const newApiKey = anthropicApiKey.trim()
    const newAuthToken = anthropicAuthToken.trim()
    const newOpenaiKey = openaiApiKey.trim()
    const autoStopChanged = sandboxAutoStopInterval !== initialAutoStopInterval

    // Check if there's anything to save
    const hasCredentialChanges =
      (anthropicAuthType === "api-key" && newApiKey) ||
      (anthropicAuthType === "claude-max" && newAuthToken) ||
      newOpenaiKey

    if (!hasCredentialChanges && !autoStopChanged) {
      onClose()
      return
    }

    setIsSaving(true)
    setSaveStatus(null)

    try {
      const response = await fetch("/api/user/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anthropicAuthType,
          anthropicApiKey: anthropicAuthType === "api-key" ? newApiKey : undefined,
          anthropicAuthToken: anthropicAuthType === "claude-max" ? newAuthToken : undefined,
          openaiApiKey: newOpenaiKey || undefined,
          sandboxAutoStopInterval,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setSaveStatus({
          message: data.error || "Failed to save settings",
          isError: true,
        })
        return
      }

      // If auto-stop interval changed, update all existing sandboxes
      if (autoStopChanged) {
        setSaveStatus({
          message: "Updating sandbox timeouts...",
          isError: false,
        })

        const autostopResponse = await fetch("/api/sandbox/autostop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interval: sandboxAutoStopInterval }),
        })

        if (!autostopResponse.ok) {
          const autostopData = await autostopResponse.json()
          setSaveStatus({
            message: autostopData.error || "Failed to update sandbox timeouts",
            isError: true,
          })
          return
        }
      }

      setSaveStatus({
        message: "Settings saved",
        isError: false,
      })
      onCredentialsUpdate()
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch {
      setSaveStatus({
        message: "Failed to save settings",
        isError: true,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh]">
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

        {/* Anthropic Credentials */}
        <div className="flex flex-col gap-4 px-4 sm:px-5 py-4 overflow-y-auto">
          {/* Anthropic Auth */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Anthropic Authentication</label>
              {(credentials?.hasAnthropicApiKey || credentials?.hasAnthropicAuthToken) && (
                <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">Configured</span>
              )}
            </div>
            <div className="flex rounded-md border border-border bg-secondary p-0.5">
              <button
                type="button"
                onClick={() => setAnthropicAuthType("api-key")}
                className={cn(
                  "flex-1 rounded px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                  anthropicAuthType === "api-key"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                API Key
              </button>
              <button
                type="button"
                onClick={() => setAnthropicAuthType("claude-max")}
                className={cn(
                  "flex-1 rounded px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                  anthropicAuthType === "claude-max"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Subscription
              </button>
            </div>
            {anthropicAuthType === "api-key" ? (
              <>
                <Input
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by Claude Code agent inside sandboxes
                </p>
              </>
            ) : (
              <>
                <textarea
                  placeholder='{"claudeAiOauth":{"token_type":"bearer",...}}'
                  value={anthropicAuthToken}
                  onChange={(e) => setAnthropicAuthToken(e.target.value)}
                  rows={3}
                  className="w-full rounded-md bg-secondary border border-border px-3 py-2 text-xs font-mono placeholder:text-muted-foreground/40 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">
                  Paste the output of:{" "}
                  <code
                    className="text-[10px] cursor-pointer"
                    onClick={() => {
                      navigator.clipboard.writeText('security find-generic-password -s "Claude Code-credentials" -w')
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied
                      ? <Check className="inline h-2.5 w-2.5 text-green-500 mr-1 align-middle" />
                      : <Copy className="inline h-2.5 w-2.5 text-muted-foreground/60 mr-1 align-middle" />}
                    security find-generic-password -s &quot;Claude Code-credentials&quot; -w
                  </code>
                </p>
              </>
            )}
          </div>

          {/* OpenAI API Key */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <Code className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">OpenAI API Key</label>
              {credentials?.hasOpenaiApiKey && (
                <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">Configured</span>
              )}
            </div>
            <Input
              type="password"
              placeholder="sk-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground">
              Required for Codex agent and OpenCode with OpenAI models
            </p>
          </div>

          {/* Sandbox Settings */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Sandbox Auto-Stop</label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={5}
                max={20}
                value={sandboxAutoStopInterval}
                onChange={(e) => setSandboxAutoStopInterval(Number(e.target.value))}
                className="flex-1 h-1.5 bg-secondary rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <span className="text-xs font-medium text-foreground w-16 text-right">{sandboxAutoStopInterval} min</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sandboxes will auto-stop after {sandboxAutoStopInterval} minutes of inactivity
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {/* Save status */}
          <div className="flex items-center gap-2 text-xs">
            {isSaving && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving credentials...</span>
              </>
            )}
            {saveStatus && !isSaving && (
              <span className={saveStatus.isError ? "text-destructive" : "text-green-500"}>
                {saveStatus.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
