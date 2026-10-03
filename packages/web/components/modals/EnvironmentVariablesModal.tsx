"use client"

import { useState, useEffect, useRef, type DragEvent } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Plus, Trash2, FolderGit2, Loader2, Upload, ClipboardPaste, Check } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { VariableIcon } from "@/components/icons/variable-icon"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { parseDotEnv, mergeEnvEntries, type ParsedEnvEntry } from "@/lib/dotenv"
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
  onBulkPaste,
  autoFocus,
}: {
  envVar: EnvVar
  onChange: (updated: EnvVar) => void
  onDelete: () => void
  /** Called when `.env`-style text is pasted into the key field. */
  onBulkPaste: (entries: ParsedEnvEntry[]) => void
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
        onPaste={(e) => {
          // Variable names never contain "=" or newlines, so text with either
          // is a `KEY=value` line or a whole .env file: split it into rows.
          const text = e.clipboardData.getData("text")
          if (!/[=\n]/.test(text)) return
          const entries = parseDotEnv(text)
          if (entries.length === 0) return
          e.preventDefault()
          onBulkPaste(entries)
        }}
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
  const [showPasteArea, setShowPasteArea] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [importStatus, setImportStatus] = useState<{ message: string; error?: boolean } | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)

  // Auto-hide the import status message
  useEffect(() => {
    if (!importStatus) return
    const timer = setTimeout(() => setImportStatus(null), 4000)
    return () => clearTimeout(timer)
  }, [importStatus])

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
      setShowPasteArea(false)
      setPasteText("")
      setImportStatus(null)
      setIsDraggingFile(false)
      dragDepthRef.current = 0
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

  /** Merge parsed entries into the active tab; returns false if nothing was found. */
  const importEntries = (entries: ParsedEnvEntry[], source: string): boolean => {
    if (entries.length === 0) {
      setImportStatus({ message: `No variables found in ${source}. Expected lines like KEY=value.`, error: true })
      return false
    }
    const setVars = activeTab === "chat" ? setChatEnvVars : setRepoEnvVars
    const current = activeTab === "chat" ? chatEnvVars : repoEnvVars
    const { vars, added, updated } = mergeEnvEntries(current, entries, (entry) => ({
      id: nanoid(),
      ...entry,
    }))
    setVars(vars)
    setNewVarId(null)
    const parts: string[] = []
    if (added) parts.push(`added ${added}`)
    if (updated) parts.push(`updated ${updated}`)
    const summary = parts.length ? parts.join(", ") : "no changes"
    setImportStatus({ message: `Imported from ${source}: ${summary}.` })
    return true
  }

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    try {
      const texts = await Promise.all(list.map((f) => f.text()))
      const entries = texts.flatMap((t) => parseDotEnv(t))
      const source = list.length === 1 ? list[0].name : `${list.length} files`
      importEntries(entries, source)
    } catch (error) {
      console.error("Failed to read env file:", error)
      setImportStatus({ message: "Couldn't read that file.", error: true })
    }
  }

  const handlePasteAreaSubmit = () => {
    if (importEntries(parseDotEnv(pasteText), "pasted text")) {
      setPasteText("")
      setShowPasteArea(false)
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepthRef.current++
      setIsDraggingFile(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setIsDraggingFile(false)
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepthRef.current = 0
      setIsDraggingFile(false)
      void importFiles(e.dataTransfer.files)
    },
  }

  const pasteEntryCount = pasteText.trim() ? parseDotEnv(pasteText).length : 0

  const activeVars = activeTab === "chat" ? chatEnvVars : repoEnvVars
  const activeTitle = activeTab === "chat" ? "Chat" : (repoName || "Repository")
  const hasRepository = !!repoName

  const actionButtonClass =
    "flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"

  const renderContent = () => (
    <>
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-2">
        <button
          type="button"
          onClick={() => handleAddVariable(activeTab)}
          className={actionButtonClass}
        >
          <Plus className="h-4 w-4" />
          Add variable
        </button>
        <button
          type="button"
          onClick={() => setShowPasteArea((v) => !v)}
          className={cn(actionButtonClass, showPasteArea && "text-foreground")}
          aria-expanded={showPasteArea}
        >
          <ClipboardPaste className="h-4 w-4" />
          Paste .env
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={actionButtonClass}
        >
          <Upload className="h-4 w-4" />
          Upload .env file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {/* Bulk paste area */}
      {showPasteArea && (
        <div className="mb-3 rounded-lg border border-border p-3 space-y-2">
          <Textarea
            autoFocus
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handlePasteAreaSubmit()
              }
            }}
            placeholder={"# Paste the contents of your .env file\nDATABASE_URL=postgres://...\nAPI_KEY=sk-..."}
            rows={6}
            className="font-mono text-xs resize-y"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {pasteText.trim()
                ? `${pasteEntryCount} variable${pasteEntryCount === 1 ? "" : "s"} detected`
                : "Existing variables with the same name will be overwritten."}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowPasteArea(false); setPasteText("") }}
                className="rounded-md hover:bg-accent transition-colors px-2.5 py-1 text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePasteAreaSubmit}
                disabled={pasteEntryCount === 0}
                className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-2.5 py-1 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add {pasteEntryCount > 0 ? pasteEntryCount : ""} variable{pasteEntryCount === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import status */}
      {importStatus && (
        <div
          role="status"
          className={cn(
            "mb-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
            importStatus.error
              ? "bg-destructive/10 text-destructive"
              : "bg-accent text-foreground"
          )}
        >
          {!importStatus.error && <Check className="h-3.5 w-3.5 shrink-0" />}
          {importStatus.message}
        </div>
      )}

      {/* Empty state */}
      {activeVars.length === 0 && !showPasteArea && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No variables yet. Add one, paste a .env file, or drop a .env file here.
        </div>
      )}

      {/* Variable list */}
      {activeVars.length > 0 && (
        <div className="space-y-1">
          {activeVars.map((envVar) => (
            <EnvVarRow
              key={envVar.id}
              envVar={envVar}
              onChange={(updated) => handleUpdateVariable(activeTab, envVar.id, updated)}
              onDelete={() => handleDeleteVariable(activeTab, envVar.id)}
              onBulkPaste={(entries) => importEntries(entries, "clipboard")}
              autoFocus={envVar.id === newVarId}
            />
          ))}
        </div>
      )}
    </>
  )

  const renderDropOverlay = () =>
    isDraggingFile ? (
      <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/60 bg-popover/90 text-sm text-foreground">
        <Upload className="h-5 w-5" />
        Drop .env file to import
      </div>
    ) : null

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
              <div ref={contentRef} className="relative flex-1 overflow-y-auto mobile-scroll p-4" {...dropHandlers}>
                {renderDropOverlay()}
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
              <div ref={contentRef} className="relative flex-1 overflow-y-auto px-5 pt-4 pb-4" {...dropHandlers}>
                {renderDropOverlay()}
                <p className="text-sm text-muted-foreground mb-4">
                  {activeTab === "chat"
                    ? "Environment variables set here will be available for this chat only. They are passed to the agent on every message."
                    : "Environment variables set here will be available for all your chats using this repository."}
                  {" "}Tip: paste <code className="font-mono text-xs">KEY=value</code> lines into a name field to add them all at once.
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
