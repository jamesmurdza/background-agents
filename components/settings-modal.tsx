"use client"

import { cn } from "@/lib/utils"
import { X, Terminal, Copy, Check, Loader2, Clock, Bot, Box, Key, ExternalLink, AlertTriangle, Trash2 } from "lucide-react"
import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"

type SettingsTab = "agents" | "sandboxes"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  credentials?: {
    anthropicAuthType: string
    hasAnthropicApiKey: boolean
    hasAnthropicAuthToken: boolean
    hasOpenaiApiKey: boolean
    hasOpenrouterApiKey: boolean
    hasDaytonaApiKey: boolean
    sandboxAutoStopInterval?: number
  } | null
  onCredentialsUpdate: () => void
  /** Field to highlight with error styling (e.g., "anthropicApiKey", "openaiApiKey") */
  highlightField?: string | null
  /** Callback to clear the highlight when user starts typing */
  onClearHighlight?: () => void
}

// Track which keys should be cleared on save
type ClearableKey = "anthropicApiKey" | "anthropicAuthToken" | "openaiApiKey" | "openrouterApiKey" | "daytonaApiKey"

export function SettingsModal({ open, onClose, credentials, onCredentialsUpdate, highlightField, onClearHighlight }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("agents")

  // Anthropic credentials (separate API key and subscription)
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [anthropicAuthToken, setAnthropicAuthToken] = useState("")

  // Other API keys
  const [openaiApiKey, setOpenaiApiKey] = useState("")
  const [openrouterApiKey, setOpenrouterApiKey] = useState("")

  // Sandbox settings
  const [sandboxAutoStopInterval, setSandboxAutoStopInterval] = useState(5)
  const [initialAutoStopInterval, setInitialAutoStopInterval] = useState(5)
  const [daytonaApiKey, setDaytonaApiKey] = useState("")

  // Track keys to clear
  const [keysToClear, setKeysToClear] = useState<Set<ClearableKey>>(new Set())

  // UI state
  const [copied, setCopied] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ message: string; isError: boolean } | null>(null)
  const [showDaytonaWarning, setShowDaytonaWarning] = useState(false)
  const [daytonaWarningConfirmed, setDaytonaWarningConfirmed] = useState(false)

  // Sync form state when modal opens
  useEffect(() => {
    if (open) {
      setAnthropicApiKey("")
      setAnthropicAuthToken("")
      setOpenaiApiKey("")
      setOpenrouterApiKey("")
      setDaytonaApiKey("")
      setKeysToClear(new Set())
      const interval = credentials?.sandboxAutoStopInterval ?? 5
      setSandboxAutoStopInterval(interval)
      setInitialAutoStopInterval(interval)
      setSaveStatus(null)
      setShowDaytonaWarning(false)
      setDaytonaWarningConfirmed(false)
    }
  }, [open, credentials])

  // Handle highlight field - switch tab and scroll to field
  useEffect(() => {
    if (highlightField && open) {
      // Switch to agents tab if highlighting an agent-related field
      if (["anthropicApiKey", "anthropicAuthToken", "openaiApiKey", "openrouterApiKey"].includes(highlightField)) {
        setActiveTab("agents")
      }
      // Scroll field into view after a short delay to allow tab switch
      setTimeout(() => {
        const fieldElement = document.getElementById(`field-${highlightField}`)
        fieldElement?.scrollIntoView({ behavior: "smooth", block: "center" })
        fieldElement?.focus()
      }, 100)
    }
  }, [highlightField, open])

  if (!open) return null

  function markKeyToClear(key: ClearableKey) {
    setKeysToClear(prev => new Set(prev).add(key))
  }

  function unmarkKeyToClear(key: ClearableKey) {
    setKeysToClear(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  async function handleSave(skipDaytonaWarning = false) {
    const newAnthropicKey = anthropicApiKey.trim()
    const newAuthToken = anthropicAuthToken.trim()
    const newOpenaiKey = openaiApiKey.trim()
    const newOpenrouterKey = openrouterApiKey.trim()
    const newDaytonaKey = daytonaApiKey.trim()
    const autoStopChanged = sandboxAutoStopInterval !== initialAutoStopInterval

    // Check if Daytona key is being changed and show warning (if not already confirmed)
    if ((newDaytonaKey || keysToClear.has("daytonaApiKey")) && !skipDaytonaWarning && !daytonaWarningConfirmed) {
      setShowDaytonaWarning(true)
      return
    }

    // Check if there's anything to save
    const hasAnyChanges =
      newAnthropicKey ||
      newAuthToken ||
      newOpenaiKey ||
      newOpenrouterKey ||
      newDaytonaKey ||
      autoStopChanged ||
      keysToClear.size > 0

    if (!hasAnyChanges) {
      onClose()
      return
    }

    setIsSaving(true)
    setSaveStatus(null)

    try {
      // Build payload with only non-empty values to avoid overwriting existing keys
      const payload: Record<string, unknown> = {}

      // Only include credentials that have been entered (non-empty)
      if (newAnthropicKey) {
        payload.anthropicApiKey = newAnthropicKey
      }
      if (newAuthToken) {
        payload.anthropicAuthToken = newAuthToken
      }
      if (newOpenaiKey) {
        payload.openaiApiKey = newOpenaiKey
      }
      if (newOpenrouterKey) {
        payload.openrouterApiKey = newOpenrouterKey
      }
      if (newDaytonaKey) {
        payload.daytonaApiKey = newDaytonaKey
      }
      if (autoStopChanged) {
        payload.sandboxAutoStopInterval = sandboxAutoStopInterval
      }

      // Add keys to clear (send null to clear them)
      for (const key of keysToClear) {
        payload[key] = null
      }

      const response = await fetch("/api/user/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  // Helper to render status indicator
  function renderStatus(hasKey: boolean, keyName: ClearableKey) {
    if (keysToClear.has(keyName)) {
      return <span className="text-destructive text-[10px]">Will be cleared</span>
    }
    if (hasKey) {
      return <span className="text-green-500 text-[10px]">Configured</span>
    }
    return <span className="text-muted-foreground/50 text-[10px]">Not configured</span>
  }

  // Helper to render clear button
  function renderClearButton(hasKey: boolean, keyName: ClearableKey) {
    if (!hasKey || keysToClear.has(keyName)) return null
    return (
      <button
        type="button"
        onClick={() => markKeyToClear(keyName)}
        className="text-[10px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer flex items-center gap-1"
        title="Clear this key"
      >
        <Trash2 className="h-3 w-3" />
        Clear
      </button>
    )
  }

  // Helper to render undo clear button
  function renderUndoClearButton(keyName: ClearableKey) {
    if (!keysToClear.has(keyName)) return null
    return (
      <button
        type="button"
        onClick={() => unmarkKeyToClear(keyName)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        Undo
      </button>
    )
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

        {/* Tab Navigation */}
        <div className="flex border-b border-border px-4">
          <button
            onClick={() => setActiveTab("agents")}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px",
              activeTab === "agents"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            Agents
          </button>
          <button
            onClick={() => setActiveTab("sandboxes")}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px",
              activeTab === "sandboxes"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Box className="h-3.5 w-3.5" />
            Sandboxes
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex flex-col gap-4 px-4 sm:px-5 py-4 overflow-y-auto">
          {activeTab === "agents" && (
            <>
              {/* Anthropic API Key */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-foreground">Anthropic API Key</label>
                    {renderStatus(credentials?.hasAnthropicApiKey ?? false, "anthropicApiKey")}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderClearButton(credentials?.hasAnthropicApiKey ?? false, "anthropicApiKey")}
                    {renderUndoClearButton("anthropicApiKey")}
                    <a
                      href="https://console.anthropic.com/settings/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Get key <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
                <Input
                  id="field-anthropicApiKey"
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicApiKey}
                  onChange={(e) => {
                    setAnthropicApiKey(e.target.value)
                    if (highlightField === "anthropicApiKey") onClearHighlight?.()
                  }}
                  disabled={keysToClear.has("anthropicApiKey")}
                  aria-invalid={highlightField === "anthropicApiKey"}
                  className={cn(
                    "h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40",
                    keysToClear.has("anthropicApiKey") && "opacity-50",
                    highlightField === "anthropicApiKey" && "border-destructive ring-1 ring-destructive"
                  )}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by Claude Code and OpenCode agents for Anthropic models
                </p>
              </div>

              {/* Claude Subscription (Max) */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-foreground">Claude Subscription</label>
                    {renderStatus(credentials?.hasAnthropicAuthToken ?? false, "anthropicAuthToken")}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderClearButton(credentials?.hasAnthropicAuthToken ?? false, "anthropicAuthToken")}
                    {renderUndoClearButton("anthropicAuthToken")}
                    <a
                      href="https://claude.ai/settings/billing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Manage <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
                <textarea
                  id="field-anthropicAuthToken"
                  placeholder='{"claudeAiOauth":{"token_type":"bearer",...}}'
                  value={anthropicAuthToken}
                  onChange={(e) => {
                    setAnthropicAuthToken(e.target.value)
                    if (highlightField === "anthropicAuthToken") onClearHighlight?.()
                  }}
                  disabled={keysToClear.has("anthropicAuthToken")}
                  rows={3}
                  aria-invalid={highlightField === "anthropicAuthToken"}
                  className={cn(
                    "w-full rounded-md bg-secondary border border-border px-3 py-2 text-xs font-mono placeholder:text-muted-foreground/40 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    keysToClear.has("anthropicAuthToken") && "opacity-50",
                    highlightField === "anthropicAuthToken" && "border-destructive ring-1 ring-destructive"
                  )}
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
                <p className="text-[10px] text-muted-foreground/70">
                  Claude Code agent only. Not compatible with OpenCode agent.
                </p>
              </div>

              {/* OpenAI API Key */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-foreground">OpenAI API Key</label>
                    {renderStatus(credentials?.hasOpenaiApiKey ?? false, "openaiApiKey")}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderClearButton(credentials?.hasOpenaiApiKey ?? false, "openaiApiKey")}
                    {renderUndoClearButton("openaiApiKey")}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Get key <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
                <Input
                  id="field-openaiApiKey"
                  type="password"
                  placeholder="sk-..."
                  value={openaiApiKey}
                  onChange={(e) => {
                    setOpenaiApiKey(e.target.value)
                    if (highlightField === "openaiApiKey") onClearHighlight?.()
                  }}
                  disabled={keysToClear.has("openaiApiKey")}
                  aria-invalid={highlightField === "openaiApiKey"}
                  className={cn(
                    "h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40",
                    keysToClear.has("openaiApiKey") && "opacity-50",
                    highlightField === "openaiApiKey" && "border-destructive ring-1 ring-destructive"
                  )}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by OpenCode agent for GPT-4o models
                </p>
              </div>

              {/* OpenRouter API Key */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-foreground">OpenRouter API Key</label>
                    {renderStatus(credentials?.hasOpenrouterApiKey ?? false, "openrouterApiKey")}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderClearButton(credentials?.hasOpenrouterApiKey ?? false, "openrouterApiKey")}
                    {renderUndoClearButton("openrouterApiKey")}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Get key <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
                <Input
                  id="field-openrouterApiKey"
                  type="password"
                  placeholder="sk-or-..."
                  value={openrouterApiKey}
                  onChange={(e) => {
                    setOpenrouterApiKey(e.target.value)
                    if (highlightField === "openrouterApiKey") onClearHighlight?.()
                  }}
                  disabled={keysToClear.has("openrouterApiKey")}
                  aria-invalid={highlightField === "openrouterApiKey"}
                  className={cn(
                    "h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40",
                    keysToClear.has("openrouterApiKey") && "opacity-50",
                    highlightField === "openrouterApiKey" && "border-destructive ring-1 ring-destructive"
                  )}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by OpenCode agent for OpenRouter models
                </p>
              </div>
            </>
          )}

          {activeTab === "sandboxes" && (
            <>
              {/* Info about Daytona */}
              <p className="text-[11px] text-muted-foreground">
                Sandboxes are powered by{" "}
                <a
                  href="https://www.daytona.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:underline"
                >
                  Daytona
                </a>
                . Each agent runs in an isolated cloud development environment.
              </p>

              {/* Custom Daytona API Key */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium text-foreground">Daytona API Key</label>
                    <span className="text-[10px] text-muted-foreground/70">(Optional)</span>
                    {renderStatus(credentials?.hasDaytonaApiKey ?? false, "daytonaApiKey")}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderClearButton(credentials?.hasDaytonaApiKey ?? false, "daytonaApiKey")}
                    {renderUndoClearButton("daytonaApiKey")}
                    <a
                      href="https://app.daytona.io/dashboard/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Get key <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                </div>
                <Input
                  type="password"
                  placeholder="dtn_..."
                  value={daytonaApiKey}
                  onChange={(e) => {
                    setDaytonaApiKey(e.target.value)
                    setShowDaytonaWarning(false)
                  }}
                  disabled={keysToClear.has("daytonaApiKey")}
                  className={cn(
                    "h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40",
                    keysToClear.has("daytonaApiKey") && "opacity-50"
                  )}
                />
                <p className="text-[11px] text-muted-foreground">
                  Use your own Daytona account for sandboxes
                </p>
              </div>

              {/* Sandbox Auto-Stop */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <label className="text-xs font-medium text-foreground">Auto-Stop Timeout</label>
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {/* Save status */}
          <div className="flex items-center gap-2 text-xs">
            {isSaving && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving...</span>
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
              onClick={() => handleSave()}
              disabled={isSaving}
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Daytona API Key Change Confirmation Modal */}
      {showDaytonaWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/90 backdrop-blur-sm"
            onClick={() => setShowDaytonaWarning(false)}
          />
          <div className="relative z-10 flex w-full max-w-sm flex-col rounded-xl border border-destructive/30 bg-card shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Delete All Sandboxes?</h3>
                <p className="text-[11px] text-muted-foreground">This action cannot be undone</p>
              </div>
            </div>

            {/* Modal Content */}
            <div className="px-5 py-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {keysToClear.has("daytonaApiKey")
                  ? "Clearing your Daytona API key will permanently delete all existing sandboxes and their conversation history. Sandboxes will use the platform key going forward."
                  : "Changing your Daytona API key will permanently delete all existing sandboxes and their conversation history. New sandboxes will be created using your new API key."}
              </p>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setShowDaytonaWarning(false)}
                className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDaytonaWarning(false)
                  setDaytonaWarningConfirmed(true)
                  handleSave(true)
                }}
                disabled={isSaving}
                className="cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
