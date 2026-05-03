"use client"

import { useState, useEffect, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Plus, Trash2, FolderGit2, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Input } from "@/components/ui/input"
import type { EnvVar, EnvironmentVariables } from "@/lib/types"
import { nanoid } from "nanoid"

interface EnvironmentVariablesModalProps {
  open: boolean
  onClose: () => void
  chatId: string
  /** Repository name (e.g., "owner/repo") - undefined means hide repo tab */
  repoName?: string
  /** Callback to save environment variables */
  onSave: (chatEnvVars: Record<string, string>, repoEnvVars: Record<string, string>) => Promise<void>
  /** Initial environment variables */
  initialChatEnvVars: Record<string, string>
  initialRepoEnvVars: Record<string, string>
  isMobile?: boolean
}

type TabKey = "chat" | "repository"

/** Custom italic x icon for variables */
function VariableIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center italic font-serif", className)}>
      𝑥
    </span>
  )
}

type TabIcon = LucideIcon | typeof VariableIcon

const tabs: { key: TabKey; label: string; icon: TabIcon }[] = [
  { key: "chat", label: "Chat", icon: VariableIcon },
  { key: "repository", label: "Repository", icon: FolderGit2 },
]

/** Convert a Record<string, string> to EnvVar[] for UI display */
function recordToEnvVars(record: Record<string, string>): EnvVar[] {
  return Object.entries(record).map(([key, value]) => ({
    id: nanoid(),
    key,
    value,
  }))
}

/** Convert EnvVar[] to Record<string, string> for API */
function envVarsToRecord(envVars: EnvVar[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const { key, value } of envVars) {
    if (key.trim()) {
      record[key.trim()] = value
    }
  }
  return record
}

function EnvVarRow({
  envVar,
  onChange,
  onDelete,
  autoFocus,
}: {
  envVar: EnvVar
  onChange: (updated: EnvVar) => void
  onDelete: () => void
  autoFocus?: boolean
}) {
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      keyRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <div className="flex items-center gap-2 py-2">
      <Input
        ref={keyRef}
        type="text"
        value={envVar.key}
        onChange={(e) => onChange({ ...envVar, key: e.target.value })}
        placeholder="KEY"
        className="flex-1 font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="text-muted-foreground">=</span>
      <Input
        type="text"
        value={envVar.value}
        onChange={(e) => onChange({ ...envVar, value: e.target.value })}
        placeholder="value"
        className="flex-1 font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={onDelete}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        aria-label="Delete variable"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

export function EnvironmentVariablesModal({
  open,
  onClose,
  chatId,
  repoName,
  onSave,
  initialChatEnvVars,
  initialRepoEnvVars,
  isMobile = false,
}: EnvironmentVariablesModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Local state for editing
  const [chatEnvVars, setChatEnvVars] = useState<EnvVar[]>([])
  const [repoEnvVars, setRepoEnvVars] = useState<EnvVar[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>("chat")
  const [newVarId, setNewVarId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setChatEnvVars(recordToEnvVars(initialChatEnvVars))
      setRepoEnvVars(recordToEnvVars(initialRepoEnvVars))
      setActiveTab("chat")
      setNewVarId(null)
      setIsSaving(false)
    }
  }, [open, initialChatEnvVars, initialRepoEnvVars])

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await onSave(envVarsToRecord(chatEnvVars), envVarsToRecord(repoEnvVars))
      onClose()
    } catch (error) {
      console.error("Failed to save environment variables:", error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddVariable = (tab: TabKey) => {
    const newVar: EnvVar = { id: nanoid(), key: "", value: "" }
    setNewVarId(newVar.id)
    if (tab === "chat") {
      setChatEnvVars((prev) => [...prev, newVar])
    } else {
      setRepoEnvVars((prev) => [...prev, newVar])
    }
  }

  const handleUpdateVariable = (tab: TabKey, id: string, updated: EnvVar) => {
    if (tab === "chat") {
      setChatEnvVars((prev) => prev.map((v) => (v.id === id ? updated : v)))
    } else {
      setRepoEnvVars((prev) => prev.map((v) => (v.id === id ? updated : v)))
    }
  }

  const handleDeleteVariable = (tab: TabKey, id: string) => {
    if (tab === "chat") {
      setChatEnvVars((prev) => prev.filter((v) => v.id !== id))
    } else {
      setRepoEnvVars((prev) => prev.filter((v) => v.id !== id))
    }
  }

  const activeVars = activeTab === "chat" ? chatEnvVars : repoEnvVars
  const activeTitle = activeTab === "chat" ? "Chat" : (repoName || "Repository")
  const hasRepository = !!repoName

  const renderContent = () => (
    <>
      {/* Add button at top */}
      <button
        type="button"
        onClick={() => handleAddVariable(activeTab)}
        className="flex items-center gap-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2 cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Add variable
      </button>

      {/* Variable list */}
      {activeVars.length > 0 && (
        <div className="space-y-1">
          {activeVars.map((envVar) => (
            <EnvVarRow
              key={envVar.id}
              envVar={envVar}
              onChange={(updated) => handleUpdateVariable(activeTab, envVar.id, updated)}
              onDelete={() => handleDeleteVariable(activeTab, envVar.id)}
              autoFocus={envVar.id === newVarId}
            />
          ))}
        </div>
      )}
    </>
  )

  // Filter tabs based on whether repo exists
  const visibleTabs = hasRepository ? tabs : tabs.filter((t) => t.key === "chat")

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
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl h-[480px] max-h-[80vh] border border-border rounded-xl shadow-xl",
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
                  Environment Variables
                </Dialog.Title>
                <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target cursor-pointer">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              {/* Tabs (only show if more than one) */}
              {visibleTabs.length > 1 && (
                <div className="flex border-b border-border px-4">
                  {visibleTabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 -mb-px cursor-pointer",
                          isActive
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto mobile-scroll p-4">
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
                  Environment Variables
                </Dialog.Title>
                <Dialog.Close
                  className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>

              {/* Horizontal tabs (only show if more than one) */}
              {visibleTabs.length > 1 && (
                <div className="flex border-b border-border px-5">
                  {visibleTabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px cursor-pointer",
                          isActive
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
                <p className="text-sm text-muted-foreground mb-4">
                  {activeTab === "chat"
                    ? "Environment variables set here will be available for this chat only. They are passed to the agent on every message."
                    : "Environment variables set here will be available for all your chats using this repository."}
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
