"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Plus, Trash2, Variable, FolderGit2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { Input } from "@/components/ui/input"
import type { EnvVar, EnvironmentVariables } from "@/lib/storage"

// Re-export types for convenience
export type { EnvVar, EnvironmentVariables }

interface EnvironmentVariablesModalProps {
  open: boolean
  onClose: () => void
  /** Current environment variables */
  envVars: EnvironmentVariables
  /** Callback when environment variables change */
  onChange: (envVars: EnvironmentVariables) => void
  /** Repository name (for display, e.g., "owner/repo") */
  repoName?: string
  /** Whether the chat has a repository linked */
  hasRepository?: boolean
  isMobile?: boolean
}

type TabKey = "chat" | "repository"

const tabs: { key: TabKey; label: string; icon: typeof Variable }[] = [
  { key: "chat", label: "Chat", icon: Variable },
  { key: "repository", label: "Repository", icon: FolderGit2 },
]

const SWIPE_THRESHOLD = 100

let idCounter = 0
function generateId(): string {
  return `env-${Date.now()}-${++idCounter}`
}

function EnvVarRow({
  envVar,
  onChange,
  onDelete,
  isNew,
}: {
  envVar: EnvVar
  onChange: (updated: EnvVar) => void
  onDelete: () => void
  isNew?: boolean
}) {
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isNew) {
      keyRef.current?.focus()
    }
  }, [isNew])

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
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
  envVars,
  onChange,
  repoName,
  hasRepository = false,
  isMobile = false,
}: EnvironmentVariablesModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Local state for editing
  const [localEnvVars, setLocalEnvVars] = useState<EnvironmentVariables>(envVars)
  const [activeTab, setActiveTab] = useState<TabKey>("chat")
  const [newVarId, setNewVarId] = useState<string | null>(null)

  // Swipe to dismiss state (mobile only)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setLocalEnvVars(envVars)
      setActiveTab("chat")
      setDragY(0)
      setNewVarId(null)
    }
  }, [open, envVars])

  // Swipe gesture handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const content = contentRef.current
    if (content && content.scrollTop > 0) return
    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setStartTime(Date.now())
    setDragY(0)
  }, [isMobile])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !isMobile) return
    const currentY = e.touches[0].clientY
    const diff = currentY - startY
    if (diff > 0) {
      setDragY(diff)
    }
  }, [isDragging, startY, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !isMobile) return
    setIsDragging(false)
    const duration = Date.now() - startTime
    const velocity = Math.abs(dragY) / duration
    if (dragY > SWIPE_THRESHOLD || velocity > 0.5) {
      handleSave()
    }
    setDragY(0)
  }, [isDragging, dragY, startTime, isMobile])

  const handleSave = () => {
    onChange(localEnvVars)
    onClose()
  }

  const handleAddVariable = (tab: TabKey) => {
    const newVar: EnvVar = { id: generateId(), key: "", value: "" }
    setNewVarId(newVar.id)
    setLocalEnvVars((prev) => ({
      ...prev,
      [tab]: [...prev[tab], newVar],
    }))
  }

  const handleUpdateVariable = (tab: TabKey, id: string, updated: EnvVar) => {
    setLocalEnvVars((prev) => ({
      ...prev,
      [tab]: prev[tab].map((v) => (v.id === id ? updated : v)),
    }))
  }

  const handleDeleteVariable = (tab: TabKey, id: string) => {
    setLocalEnvVars((prev) => ({
      ...prev,
      [tab]: prev[tab].filter((v) => v.id !== id),
    }))
  }

  const activeVars = localEnvVars[activeTab]
  const activeTitle = activeTab === "chat" ? "Chat" : (repoName || "Repository")

  const renderContent = () => (
    <div className="flex flex-col h-full">
      {/* Variable list */}
      <div className="flex-1 overflow-y-auto">
        {activeVars.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Variable className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No environment variables</p>
            <p className="text-xs mt-1">
              {activeTab === "chat"
                ? "Variables set here will be available for this chat only"
                : "Variables set here will be available for all chats in this repository"}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {activeVars.map((envVar) => (
              <EnvVarRow
                key={envVar.id}
                envVar={envVar}
                onChange={(updated) => handleUpdateVariable(activeTab, envVar.id, updated)}
                onDelete={() => handleDeleteVariable(activeTab, envVar.id)}
                isNew={envVar.id === newVarId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <button
        type="button"
        onClick={() => handleAddVariable(activeTab)}
        className="flex items-center gap-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
      >
        <Plus className="h-4 w-4" />
        Add variable
      </button>
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleSave()}>
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {isMobile ? (
            <>
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              {/* Header */}
              <div className="sticky top-0 flex items-center justify-between border-b border-border bg-popover z-10 px-4 py-3">
                <Dialog.Title className="font-semibold text-lg">
                  Environment Variables
                </Dialog.Title>
                <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border px-4">
                {tabs.map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.key
                  const isDisabled = tab.key === "repository" && !hasRepository
                  return (
                    <button
                      key={tab.key}
                      onClick={() => !isDisabled && setActiveTab(tab.key)}
                      disabled={isDisabled}
                      className={cn(
                        "flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 -mb-px",
                        isActive
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                        isDisabled && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  )
                })}
              </div>

              {/* Content */}
              <div ref={contentRef} className="flex-1 overflow-y-auto mobile-scroll p-4">
                {renderContent()}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-popover px-4 py-4 pb-safe">
                <button
                  onClick={onClose}
                  className="rounded-md hover:bg-accent active:bg-accent transition-colors touch-target px-6 py-3 text-base"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors touch-target px-6 py-3 text-base"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 min-h-0">
              {/* Left sidebar with tabs */}
              <aside className="w-44 flex-shrink-0 flex flex-col bg-muted/20">
                <div className="flex items-center px-3 pt-3 pb-2">
                  <Dialog.Close
                    className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Dialog.Close>
                </div>
                <nav className="flex-1 flex flex-col gap-0.5 px-2 pb-2">
                  {tabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.key
                    const isDisabled = tab.key === "repository" && !hasRepository
                    return (
                      <button
                        key={tab.key}
                        onClick={() => !isDisabled && setActiveTab(tab.key)}
                        disabled={isDisabled}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-sm text-left transition-colors cursor-pointer",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          isDisabled && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </button>
                    )
                  })}
                </nav>
              </aside>

              {/* Right pane */}
              <div className="flex-1 flex flex-col min-h-0">
                <div ref={contentRef} className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
                  <Dialog.Title className="text-xl font-medium pb-4 mb-5 border-b border-border">
                    {activeTitle}
                  </Dialog.Title>
                  <p className="text-sm text-muted-foreground mb-4">
                    {activeTab === "chat"
                      ? "Environment variables set here will be available for this chat only. They are passed to the agent on every message."
                      : "Environment variables set here will be available for all chats using this repository."}
                  </p>
                  {renderContent()}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
                  <button
                    onClick={onClose}
                    className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
