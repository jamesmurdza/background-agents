"use client"

import { useState, useEffect, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2, Github, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Switch } from "@/components/ui/switch"
import type { McpToolsConfig } from "@/lib/mcp/types"

interface McpToolsModalProps {
  open: boolean
  onClose: () => void
  chatId: string
  agentSupportsMcp: boolean
  /** Callback to save MCP tools settings */
  onSave: (mcpTools: McpToolsConfig) => Promise<void>
  /** Initial MCP tools settings */
  initialMcpTools: McpToolsConfig
  isMobile?: boolean
}

interface ToolInfo {
  key: keyof McpToolsConfig
  name: string
  description: string
  icon: React.ReactNode
  comingSoon?: boolean
}

const AVAILABLE_TOOLS: ToolInfo[] = [
  {
    key: "github",
    name: "GitHub",
    description: "Issues, PRs, comments, reviews, and more",
    icon: <Github className="h-5 w-5" />,
  },
  {
    key: "jira",
    name: "Jira",
    description: "Issues, projects, and sprints",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.005 1.005 0 0 0 23.013 0z" />
      </svg>
    ),
    comingSoon: true,
  },
  {
    key: "slack",
    name: "Slack",
    description: "Messages, channels, and users",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </svg>
    ),
    comingSoon: true,
  },
  {
    key: "linear",
    name: "Linear",
    description: "Issues, projects, and cycles",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3.483 11.575l9.05 9.05a9.054 9.054 0 0 1-9.05-9.05zm-.408 2.065a9.054 9.054 0 0 0 7.393 7.393L3.075 13.64zm-.075-4.32a10.038 10.038 0 0 0 0 5.36l9.788 9.788a10.038 10.038 0 0 0 5.36 0L3 9.32zm17.925 4.32a9.054 9.054 0 0 1-7.393 7.393l7.393-7.393zm.075-2.065l-9.788-9.788a10.038 10.038 0 0 0-5.36 0L21 9.18a10.038 10.038 0 0 0 0-5.36zM13.36 3.075l7.393 7.393a9.054 9.054 0 0 0-7.393-7.393zm-2.785-.483a9.054 9.054 0 0 1 9.05 9.05l-9.05-9.05z" />
      </svg>
    ),
    comingSoon: true,
  },
]

function ToolRow({
  tool,
  enabled,
  onChange,
  disabled,
}: {
  tool: ToolInfo
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 px-1">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted text-muted-foreground">
          {tool.icon}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{tool.name}</span>
            {tool.comingSoon && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Coming soon
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{tool.description}</span>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onChange}
        disabled={disabled || tool.comingSoon}
      />
    </div>
  )
}

export function McpToolsModal({
  open,
  onClose,
  chatId,
  agentSupportsMcp,
  onSave,
  initialMcpTools,
  isMobile = false,
}: McpToolsModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Local state for editing
  const [mcpTools, setMcpTools] = useState<McpToolsConfig>({})
  const [isSaving, setIsSaving] = useState(false)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setMcpTools(initialMcpTools)
      setIsSaving(false)
    }
  }, [open, initialMcpTools])

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await onSave(mcpTools)
      onClose()
    } catch (error) {
      console.error("Failed to save MCP tools settings:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleTool = (key: keyof McpToolsConfig, enabled: boolean) => {
    setMcpTools((prev) => ({ ...prev, [key]: enabled }))
  }

  const renderContent = () => (
    <>
      {!agentSupportsMcp && (
        <div className="flex items-start gap-3 p-3 mb-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-yellow-500">Agent not supported</p>
            <p className="text-muted-foreground mt-1">
              The current agent does not support MCP tools. Switch to Claude, Codex, Gemini, OpenCode, or Goose to use MCP tools.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {AVAILABLE_TOOLS.map((tool) => (
          <ToolRow
            key={tool.key}
            tool={tool}
            enabled={mcpTools[tool.key] ?? false}
            onChange={(enabled) => handleToggleTool(tool.key, enabled)}
            disabled={!agentSupportsMcp}
          />
        ))}
      </div>
    </>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md h-auto max-h-[80vh] border border-border rounded-xl shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          {isMobile ? (
            <>
              {/* Drag handle */}
              <div
                className="flex justify-center pt-3 pb-1"
                {...dragHandlers}
              >
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              {/* Header - also draggable */}
              <div
                className="sticky top-0 flex items-center justify-between border-b border-border bg-popover z-10 px-4 py-3"
                {...dragHandlers}
              >
                <Dialog.Title className="font-semibold text-lg">
                  MCP Tools
                </Dialog.Title>
                <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target cursor-pointer">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto mobile-scroll p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Enable MCP tools to give the agent secure access to external services. Your tokens stay on the server and are never shared with the agent.
                </p>
                {renderContent()}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-popover px-4 py-4 pb-safe">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-md hover:bg-accent active:bg-accent transition-colors touch-target px-6 py-3 text-base cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors touch-target px-6 py-3 text-base cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header with close button and title */}
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <Dialog.Title className="text-lg font-semibold">
                  MCP Tools
                </Dialog.Title>
                <Dialog.Close
                  className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Enable MCP tools to give the agent secure access to external services. Your tokens stay on the server and are never shared with the agent.
                </p>
                {renderContent()}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
