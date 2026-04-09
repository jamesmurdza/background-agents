"use client"

import { useState, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Eye, EyeOff, Key } from "lucide-react"
import type { Settings } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onSave: (settings: Settings) => void
}

export function SettingsModal({ open, onClose, settings, onSave }: SettingsModalProps) {
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey)
  const [showKey, setShowKey] = useState(false)

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAnthropicApiKey(settings.anthropicApiKey)
      setShowKey(false)
    }
  }, [open, settings])

  const handleSave = () => {
    onSave({ anthropicApiKey })
    onClose()
  }

  const hasChanges = anthropicApiKey !== settings.anthropicApiKey

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-popover border border-border rounded-lg shadow-lg z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Anthropic API Key */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                <Key className="h-4 w-4" />
                Anthropic API Key
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Required to use Claude Code. Get your API key from{" "}
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full px-3 py-2 pr-10 text-sm bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Info */}
            <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
              <p>
                Your API key is stored locally in your browser and is only sent to the server
                when creating sandboxes. It is never logged or stored on our servers.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
