"use client"

import { cn } from "@/lib/utils"
import { X, Key, Github, Terminal, Copy, Check, Loader2 } from "lucide-react"
import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import type { Settings, AnthropicAuthType, Repo } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onSave: (settings: Settings) => void
  repos?: Repo[]
}

export function SettingsModal({ open, onClose, settings, onSave, repos }: SettingsModalProps) {
  const [githubPat, setGithubPat] = useState("")
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [anthropicAuthType, setAnthropicAuthType] = useState<AnthropicAuthType>("api-key")
  const [anthropicAuthToken, setAnthropicAuthToken] = useState("")
  const [daytonaApiKey, setDaytonaApiKey] = useState("")
  const [copied, setCopied] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ message: string; isError: boolean } | null>(null)

  // Sync form state when modal opens
  useEffect(() => {
    if (open) {
      setGithubPat(settings.githubPat)
      setAnthropicApiKey(settings.anthropicApiKey)
      setAnthropicAuthType(settings.anthropicAuthType ?? "api-key")
      setAnthropicAuthToken(settings.anthropicAuthToken ?? "")
      setDaytonaApiKey(settings.daytonaApiKey)
      setSyncStatus(null)
    }
  }, [open, settings])

  if (!open) return null

  // Check if Anthropic auth has changed
  function hasAnthropicAuthChanged(): boolean {
    const newAuthType = anthropicAuthType
    const newApiKey = anthropicApiKey.trim()
    const newAuthToken = anthropicAuthToken.trim()

    if (newAuthType !== settings.anthropicAuthType) return true
    if (newAuthType === "api-key" && newApiKey !== settings.anthropicApiKey) return true
    if (newAuthType === "claude-max" && newAuthToken !== settings.anthropicAuthToken) return true
    return false
  }

  // Sync auth to all sandboxes
  async function syncAuthToSandboxes(newSettings: Settings): Promise<void> {
    if (!repos) return

    // Collect all sandbox IDs from all repos
    const sandboxIds = repos
      .flatMap((repo) => repo.branches)
      .filter((branch) => branch.sandboxId)
      .map((branch) => branch.sandboxId as string)

    if (sandboxIds.length === 0) return

    setIsSyncing(true)
    setSyncStatus(null)

    try {
      const response = await fetch("/api/sandbox/update-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: newSettings.daytonaApiKey,
          anthropicApiKey: newSettings.anthropicApiKey,
          anthropicAuthType: newSettings.anthropicAuthType,
          anthropicAuthToken: newSettings.anthropicAuthToken,
          sandboxIds,
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        setSyncStatus({
          message: `Updated ${data.updated || 0} sandbox(es), ${data.failed || 0} failed`,
          isError: data.failed > 0,
        })
      } else {
        setSyncStatus({
          message: `Updated auth in ${data.updated} sandbox(es)`,
          isError: false,
        })
      }
    } catch (error) {
      setSyncStatus({
        message: "Failed to sync auth to sandboxes",
        isError: true,
      })
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleSave() {
    const newSettings: Settings = {
      githubPat: githubPat.trim(),
      anthropicApiKey: anthropicApiKey.trim(),
      anthropicAuthType,
      anthropicAuthToken: anthropicAuthToken.trim(),
      daytonaApiKey: daytonaApiKey.trim(),
    }

    // Check if we need to sync auth to sandboxes
    const authChanged = hasAnthropicAuthChanged()

    // Save settings first
    onSave(newSettings)

    // If auth changed and we have repos with sandboxes, sync them
    if (authChanged && newSettings.daytonaApiKey) {
      await syncAuthToSandboxes(newSettings)
      // Wait a moment to show the status before closing
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      onClose()
    }
  }

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
            value={githubPat}
            onChange={(e) => setGithubPat(e.target.value)}
            className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Required for cloning repos, creating branches, and pushing code.
            Needs <code className="text-[10px]">repo</code> scope.
          </p>
        </div>

        {/* API Keys */}
        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Anthropic Auth */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Anthropic Authentication</label>
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

          {/* Daytona API Key */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Daytona API Key</label>
            </div>
            <Input
              type="password"
              placeholder="dtn_..."
              value={daytonaApiKey}
              onChange={(e) => setDaytonaApiKey(e.target.value)}
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground">
              Used for creating cloud sandboxes.{" "}
              <a
                href="https://app.daytona.io/dashboard/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Get a key
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {/* Sync status */}
          <div className="flex items-center gap-2 text-xs">
            {isSyncing && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Syncing auth to sandboxes...</span>
              </>
            )}
            {syncStatus && !isSyncing && (
              <span className={syncStatus.isError ? "text-destructive" : "text-green-500"}>
                {syncStatus.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSyncing}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSyncing}
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncing ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
