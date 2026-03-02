"use client"

import { cn } from "@/lib/utils"
import { X, Key, Github, Terminal, Copy, Check } from "lucide-react"
import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import type { Settings, AnthropicAuthType } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onSave: (settings: Settings) => void
}

export function SettingsModal({ open, onClose, settings, onSave }: SettingsModalProps) {
  const [githubPat, setGithubPat] = useState("")
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [anthropicAuthType, setAnthropicAuthType] = useState<AnthropicAuthType>("api-key")
  const [anthropicAuthToken, setAnthropicAuthToken] = useState("")
  const [daytonaApiKey, setDaytonaApiKey] = useState("")
  const [copied, setCopied] = useState(false)

  // Sync form state when modal opens
  useEffect(() => {
    if (open) {
      setGithubPat(settings.githubPat)
      setAnthropicApiKey(settings.anthropicApiKey)
      setAnthropicAuthType(settings.anthropicAuthType ?? "api-key")
      setAnthropicAuthToken(settings.anthropicAuthToken ?? "")
      setDaytonaApiKey(settings.daytonaApiKey)
    }
  }, [open, settings])

  if (!open) return null

  function handleSave() {
    onSave({
      githubPat: githubPat.trim(),
      anthropicApiKey: anthropicApiKey.trim(),
      anthropicAuthType,
      anthropicAuthToken: anthropicAuthToken.trim(),
      daytonaApiKey: daytonaApiKey.trim(),
    })
    onClose()
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
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
