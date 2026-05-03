"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Eye, EyeOff, Key, Sun, Moon, Monitor, Bot, Settings as SettingsIcon, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import type { Settings, Theme, Agent, ModelOption, Credentials, CredentialFlags } from "@/lib/types"
import { agentModels, agentLabels, hasCredentialsForModel, ALL_AGENTS, getDefaultAgent, getDefaultModelForAgent } from "@/lib/types"
import {
  CREDENTIAL_KEYS,
  type CredentialId,
  type ProviderId,
} from "@/lib/credentials"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Which provider's API key field to highlight */
export type HighlightKey = ProviderId | null

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  credentialFlags: CredentialFlags
  onSave: (data: {
    settings?: Partial<Settings>
    credentials?: Credentials
  }) => Promise<{ ok: boolean; error?: string }>
  /** Which provider's first API key field to highlight with a red outline */
  highlightKey?: HighlightKey
  isMobile?: boolean
}

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]


type SectionKey = "general" | "api-keys" | "appearance"

const sections: { key: SectionKey; label: string; icon: typeof Bot }[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "api-keys", label: "API Keys", icon: Key },
  { key: "appearance", label: "Appearance", icon: Sun },
]

const MASK = "***"

/** Initial input values: "***" for credentials the server already has, "" otherwise. */
function initialCredValues(flags: CredentialFlags): Record<CredentialId, string> {
  const out = {} as Record<CredentialId, string>
  for (const { id } of CREDENTIAL_KEYS) {
    out[id] = flags[id] ? MASK : ""
  }
  return out
}

// A single settings row: label + optional description on the left, control on the right.
// Pass `stacked` when the control is tall (e.g. textarea) — then the control goes below.
function SettingsRow({
  label,
  description,
  children,
  stacked = false,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-4 py-3 border-b border-border/30 last:border-b-0",
        stacked ? "flex-col" : "items-center justify-between"
      )}
    >
      <div className={cn("flex flex-col min-w-0", !stacked && "flex-1")}>
        <div className="text-sm font-medium truncate">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      {children !== undefined && (
        <div className={cn("flex-shrink-0", stacked ? "w-full" : "")}>
          {children}
        </div>
      )}
    </div>
  )
}

// Compact password input with show/hide toggle, sized for a SettingsRow control.
function PasswordInput({
  value,
  onChange,
  placeholder,
  highlight,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  highlight?: boolean
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative w-56">
      <Input
        ref={inputRef}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        className={cn(
          "pr-8 font-mono",
          highlight && "border-red-500 focus:border-red-500 focus:ring-red-500/30"
        )}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}


// Inline clickable <code> that copies to clipboard and shows a brief check.
function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <code
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="cursor-pointer inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
    >
      {copied ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" />}
      {text}
    </code>
  )
}

export function SettingsModal({ open, onClose, settings, credentialFlags, onSave, highlightKey, isMobile = false }: SettingsModalProps) {
  const { setTheme } = useTheme()

  // Refs for API key inputs, keyed by credential id.
  const inputRefs = useRef<Partial<Record<CredentialId, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const setInputRef = useCallback(
    (id: CredentialId) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      inputRefs.current[id] = el
    },
    []
  )
  const contentRef = useRef<HTMLDivElement>(null)

  // Form state
  const [credValues, setCredValues] = useState<Record<CredentialId, string>>(() =>
    initialCredValues(credentialFlags)
  )
  const initialCreds = useMemo(() => initialCredValues(credentialFlags), [credentialFlags])

  // Resolve null preference against current credential flags so the dropdown
  // shows whatever new chats would actually use. Snapshotted off saved flags
  // (not in-form values) so it doesn't drift while the user types keys.
  const initialDefaultAgent = useMemo<Agent>(
    () => (settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent,
    [settings.defaultAgent, credentialFlags]
  )
  const initialDefaultModel = useMemo<string>(
    () => settings.defaultModel ?? getDefaultModelForAgent(initialDefaultAgent, credentialFlags),
    [settings.defaultModel, initialDefaultAgent, credentialFlags]
  )

  const [defaultAgent, setDefaultAgent] = useState<Agent>(initialDefaultAgent)
  const [defaultModel, setDefaultModel] = useState(initialDefaultModel)
  const [selectedTheme, setSelectedTheme] = useState<Theme>(settings.theme)
  const [activeSection, setActiveSection] = useState<SectionKey>("general")

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging, dragRef } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Flags reflecting the current form state — a typed value or "***" mask
  // both count as "credential present" for model availability checks.
  const liveFlags = useMemo<CredentialFlags>(() => {
    const out: CredentialFlags = {}
    for (const { id } of CREDENTIAL_KEYS) {
      out[id] = !!credValues[id]
    }
    return out
  }, [credValues])

  // Get available models for the selected agent
  const availableModels = useMemo(() => {
    return agentModels[defaultAgent] ?? []
  }, [defaultAgent])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCredValues(initialCredValues(credentialFlags))
      setDefaultAgent(initialDefaultAgent)
      setDefaultModel(initialDefaultModel)
      setSelectedTheme(settings.theme)
    }
  }, [open, settings, credentialFlags, initialDefaultAgent, initialDefaultModel])

  // Switch to API Keys tab when a key is highlighted
  useEffect(() => {
    if (open && highlightKey) {
      setActiveSection("api-keys")
    }
  }, [open, highlightKey])

  // Focus the highlighted API key field when modal opens
  useEffect(() => {
    if (open && highlightKey) {
      const target = CREDENTIAL_KEYS.find((c) => c.provider === highlightKey)
      if (!target) return
      const timer = setTimeout(() => {
        const el = inputRefs.current[target.id]
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          el.focus()
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [open, highlightKey])

  // Update model when agent changes
  useEffect(() => {
    const models = agentModels[defaultAgent] ?? []
    // If current model isn't valid for the new agent, select the first available
    const isValidModel = models.some(m => m.value === defaultModel)
    if (!isValidModel && models.length > 0) {
      setDefaultModel(models[0].value)
    }
  }, [defaultAgent, defaultModel])

  // Apply theme immediately when changed
  const handleThemeChange = (theme: Theme) => {
    setSelectedTheme(theme)
    setTheme(theme)
  }

  // Save status — drives the inline feedback above the Save button.
  const [saveStatus, setSaveStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" })

  const credChanged = useMemo(() => {
    for (const { id } of CREDENTIAL_KEYS) {
      if (credValues[id] !== initialCreds[id]) return true
    }
    return false
  }, [credValues, initialCreds])

  // Compare against the resolved baseline so picking the same value the auto-
  // resolver chose doesn't get persisted as an explicit preference.
  const settingsChanged =
    defaultAgent !== initialDefaultAgent ||
    defaultModel !== initialDefaultModel ||
    selectedTheme !== settings.theme

  const hasChanges = credChanged || settingsChanged

  const handleSave = async () => {
    if (saveStatus.kind === "saving") return

    const settingsPatch: Partial<Settings> = {}
    if (defaultAgent !== initialDefaultAgent) settingsPatch.defaultAgent = defaultAgent
    if (defaultModel !== initialDefaultModel) settingsPatch.defaultModel = defaultModel
    if (selectedTheme !== settings.theme) settingsPatch.theme = selectedTheme

    // Only send credential fields the user actually changed. Sending the
    // mask back ("***") would otherwise overwrite the real key.
    const credentialsPatch: Credentials = {}
    for (const { id } of CREDENTIAL_KEYS) {
      const next = credValues[id]
      if (next === initialCreds[id]) continue
      if (next === MASK) continue
      credentialsPatch[id] = next
    }

    const data: Parameters<typeof onSave>[0] = {}
    if (Object.keys(settingsPatch).length > 0) data.settings = settingsPatch
    if (Object.keys(credentialsPatch).length > 0) data.credentials = credentialsPatch

    if (Object.keys(data).length === 0) {
      onClose()
      return
    }

    setSaveStatus({ kind: "saving" })
    const result = await onSave(data)
    if (result.ok) {
      setSaveStatus({ kind: "saved" })
      setTimeout(() => {
        setSaveStatus({ kind: "idle" })
        onClose()
      }, 700)
    } else {
      setSaveStatus({
        kind: "error",
        message: result.error ?? "Failed to save settings",
      })
    }
  }

  const setCredValue = useCallback((id: CredentialId, value: string) => {
    setCredValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  // Handle keyboard shortcuts (Cmd/Ctrl+Enter to save)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (hasChanges && saveStatus.kind !== "saving") {
        handleSave()
      }
    }
  }

  // Section content blocks (reused across desktop and mobile layouts)
  const generalSection = (
    <div>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base mb-2">
          <SettingsIcon className="h-5 w-5" />
          General
        </h3>
      )}
      <SettingsRow label="Agent">
        <Select value={defaultAgent} onValueChange={(v) => setDefaultAgent(v as Agent)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {ALL_AGENTS.map((agent) => (
              <SelectItem key={agent} value={agent}>
                {agentLabels[agent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Model">
        <Select value={defaultModel} onValueChange={setDefaultModel}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((model: ModelOption) => {
              const hasCredentials = hasCredentialsForModel(model, liveFlags, defaultAgent)
              return (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                  {!hasCredentials && model.requiresKey !== "none" ? " (needs API key)" : ""}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )

  const renderHelpLink = (href: string, text = "Get key") => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {text}
    </a>
  )

  const apiKeysSection = (
    <div>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base mb-2">
          <Key className="h-5 w-5" />
          API Keys
        </h3>
      )}
      {CREDENTIAL_KEYS.map((field) => {
        const isHighlighted =
          highlightKey === field.provider &&
          // Highlight only the first field for the matching provider.
          CREDENTIAL_KEYS.find((c) => c.provider === field.provider)?.id === field.id
        const value = credValues[field.id]
        const description = field.description
          ? field.description
          : field.helpUrl
          ? renderHelpLink(field.helpUrl)
          : undefined

        if (field.multiline) {
          return (
            <SettingsRow key={field.id} label={field.label} description={description} stacked>
              <Textarea
                ref={setInputRef(field.id) as (el: HTMLTextAreaElement | null) => void}
                value={value}
                onChange={(e) => setCredValue(field.id, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
                autoComplete="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                className="font-mono text-xs"
              />
              {field.id === "CLAUDE_CODE_CREDENTIALS" && (
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  <p>Leave empty to use the shared pool.</p>
                  <p>
                    Or sign in with <CopyCode text="claude auth login" />
                  </p>
                  <p>
                    Then paste the output of{" "}
                    <CopyCode text={'security find-generic-password -s "Claude Code-credentials" -w'} />
                  </p>
                </div>
              )}
            </SettingsRow>
          )
        }

        return (
          <SettingsRow key={field.id} label={field.label} description={description}>
            <PasswordInput
              value={value}
              onChange={(v) => setCredValue(field.id, v)}
              placeholder={field.placeholder}
              highlight={isHighlighted}
              inputRef={setInputRef(field.id) as (el: HTMLInputElement | null) => void}
            />
          </SettingsRow>
        )
      })}
    </div>
  )

  const appearanceSection = (
    <div>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base mb-2">
          <Sun className="h-5 w-5" />
          Appearance
        </h3>
      )}
      <SettingsRow label="Theme">
        <Select value={selectedTheme} onValueChange={(v) => handleThemeChange(v as Theme)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )

  const activeTitle = sections.find((s) => s.key === activeSection)?.label ?? "Settings"

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          onKeyDown={handleKeyDown}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-[600px] max-h-[85vh] border border-border rounded-xl shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? {
            transform: `translateY(${dragY}px)`,
          } : undefined}
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
                  Settings
                </Dialog.Title>
                <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent transition-colors p-2 -mr-2 touch-target">
                  <X className="h-5 w-5" />
                </Dialog.Close>
              </div>

              {/* Content */}
              <div
                ref={contentRef}
                className="flex-1 overflow-y-auto mobile-scroll p-4 space-y-8"
              >
                {generalSection}
                {apiKeysSection}
                {appearanceSection}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-popover px-4 py-4 pb-safe">
                {saveStatus.kind === "error" && (
                  <span className="text-sm text-destructive flex-1">{saveStatus.message}</span>
                )}
                {saveStatus.kind === "saved" && (
                  <span className="text-sm text-muted-foreground flex-1">Saved</span>
                )}
                <button
                  onClick={onClose}
                  disabled={saveStatus.kind === "saving"}
                  className="rounded-md hover:bg-accent active:bg-accent transition-colors touch-target px-6 py-3 text-base disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!hasChanges || saveStatus.kind === "saving"}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-target px-6 py-3 text-base"
                >
                  {saveStatus.kind === "saving" ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 min-h-0">
              {/* Left sidebar */}
              <aside className="w-52 flex-shrink-0 flex flex-col bg-muted/20">
                <div className="flex items-center px-3 pt-3 pb-2">
                  <Dialog.Close
                    className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Dialog.Close>
                </div>
                <nav className="flex-1 flex flex-col gap-0.5 px-2 pb-2">
                  {sections.map((s) => {
                    const Icon = s.icon
                    const isActive = activeSection === s.key
                    return (
                      <button
                        key={s.key}
                        onClick={() => setActiveSection(s.key)}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2.5 rounded-md text-sm text-left transition-colors cursor-pointer",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {s.label}
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
                  {activeSection === "general" && generalSection}
                  {activeSection === "api-keys" && apiKeysSection}
                  {activeSection === "appearance" && appearanceSection}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-3">
                  {saveStatus.kind === "error" && (
                    <span className="text-sm text-destructive flex-1">{saveStatus.message}</span>
                  )}
                  {saveStatus.kind === "saved" && (
                    <span className="text-sm text-muted-foreground flex-1">Saved</span>
                  )}
                  <button
                    onClick={onClose}
                    disabled={saveStatus.kind === "saving"}
                    className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || saveStatus.kind === "saving"}
                    className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-1.5 text-sm cursor-pointer"
                  >
                    {saveStatus.kind === "saving" ? "Saving…" : "Save"}
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
