"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Key, Sun, Bot, Settings as SettingsIcon, GitBranch, FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { useElectron, type LicenseDetectResult } from "@/lib/hooks/useElectron"
import type { Settings, Theme, Agent, Credentials, CredentialFlags } from "@/lib/types"
import { agentModels, getDefaultAgent, getDefaultModelForAgent } from "@/lib/types"
import {
  CREDENTIAL_KEYS,
  type CredentialId,
} from "@/lib/credentials"
import {
  GeneralSection,
  ApiKeysSection,
  GitSection,
  AppearanceSection,
  ExperimentalSection,
  initialCredValues,
  MASK,
  type HighlightKey,
} from "./settings"

// Re-export so existing callers keep working.
export type { HighlightKey }

/** Settings modal section identifier */
export type SectionKey = "general" | "api-keys" | "git" | "appearance" | "experimental"

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
  /** Which section to show by default */
  defaultSection?: SectionKey
  isMobile?: boolean
}

const sections: { key: SectionKey; label: string; icon: typeof Bot }[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "api-keys", label: "API Keys", icon: Key },
  { key: "git", label: "Git", icon: GitBranch },
  { key: "appearance", label: "Appearance", icon: Sun },
  { key: "experimental", label: "Experimental", icon: FlaskConical },
]

export function SettingsModal({ open, onClose, settings, credentialFlags, onSave, highlightKey, defaultSection = "general", isMobile = false }: SettingsModalProps) {
  const { setTheme } = useTheme()
  const { isDesktopApp, getClaudeLicenseAutoDetect, getLicenseDetectSettings, setLicenseDetectSettings } = useElectron()

  // License auto-detect state (desktop only)
  const [licenseAutoDetectEnabled, setLicenseAutoDetectEnabled] = useState(true)
  const [licenseDetectResult, setLicenseDetectResult] = useState<LicenseDetectResult | null>(null)
  const [licenseDetectLoading, setLicenseDetectLoading] = useState(false)

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
  const [rapidFireMode, setRapidFireMode] = useState(settings.rapidFireMode)
  const [enablePrepushHooks, setEnablePrepushHooks] = useState(settings.enablePrepushHooks)
  const [activeSection, setActiveSection] = useState<SectionKey>(defaultSection)

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

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCredValues(initialCredValues(credentialFlags))
      setDefaultAgent(initialDefaultAgent)
      setDefaultModel(initialDefaultModel)
      setSelectedTheme(settings.theme)
      setRapidFireMode(settings.rapidFireMode)
      setEnablePrepushHooks(settings.enablePrepushHooks)
      setActiveSection(defaultSection)
    }
  }, [open, settings, credentialFlags, initialDefaultAgent, initialDefaultModel, defaultSection])

  // Refresh license detection
  const refreshLicenseDetect = useCallback(async () => {
    if (!isDesktopApp) return
    setLicenseDetectLoading(true)
    try {
      const result = await getClaudeLicenseAutoDetect()
      setLicenseDetectResult(result)
    } finally {
      setLicenseDetectLoading(false)
    }
  }, [isDesktopApp, getClaudeLicenseAutoDetect])

  // Load license auto-detect settings and check for credentials (desktop only)
  useEffect(() => {
    if (open && isDesktopApp) {
      // Load settings
      getLicenseDetectSettings().then((settings) => {
        if (settings) {
          setLicenseAutoDetectEnabled(settings.autoDetectEnabled)
        }
      })
      // Check for auto-detected credentials
      refreshLicenseDetect()
    }
  }, [open, isDesktopApp, getLicenseDetectSettings, refreshLicenseDetect])

  // Handle auto-detect toggle change
  const handleAutoDetectToggle = useCallback(async (enabled: boolean) => {
    setLicenseAutoDetectEnabled(enabled)
    await setLicenseDetectSettings({ autoDetectEnabled: enabled })
    if (enabled) {
      // Refresh detection when enabling
      refreshLicenseDetect()
    }
  }, [setLicenseDetectSettings, refreshLicenseDetect])

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
    const isValidModel = models.some((m) => m.value === defaultModel)
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
    selectedTheme !== settings.theme ||
    rapidFireMode !== settings.rapidFireMode ||
    enablePrepushHooks !== settings.enablePrepushHooks

  // Check if auto-detected credentials should be saved (desktop only)
  const autoDetectHasNewCredentials = isDesktopApp &&
    licenseAutoDetectEnabled &&
    licenseDetectResult?.found &&
    licenseDetectResult.credentials &&
    !credentialFlags["CLAUDE_CODE_CREDENTIALS"] // Only if not already saved

  const hasChanges = credChanged || settingsChanged || autoDetectHasNewCredentials

  const handleSave = async () => {
    if (saveStatus.kind === "saving") return

    const settingsPatch: Partial<Settings> = {}
    if (defaultAgent !== initialDefaultAgent) settingsPatch.defaultAgent = defaultAgent
    if (defaultModel !== initialDefaultModel) settingsPatch.defaultModel = defaultModel
    if (selectedTheme !== settings.theme) settingsPatch.theme = selectedTheme
    if (rapidFireMode !== settings.rapidFireMode) settingsPatch.rapidFireMode = rapidFireMode
    if (enablePrepushHooks !== settings.enablePrepushHooks) settingsPatch.enablePrepushHooks = enablePrepushHooks

    // Only send credential fields the user actually changed. Sending the
    // mask back ("***") would otherwise overwrite the real key.
    const credentialsPatch: Credentials = {}
    for (const { id } of CREDENTIAL_KEYS) {
      const next = credValues[id]
      if (next === initialCreds[id]) continue
      if (next === MASK) continue
      credentialsPatch[id] = next
    }

    // If auto-detect is enabled and credentials were found, include them
    if (isDesktopApp && licenseAutoDetectEnabled && licenseDetectResult?.found && licenseDetectResult.credentials) {
      // Only include if user hasn't manually entered a different value
      const manualValue = credValues["CLAUDE_CODE_CREDENTIALS"]
      if (!manualValue || manualValue === MASK || manualValue === initialCreds["CLAUDE_CODE_CREDENTIALS"]) {
        credentialsPatch["CLAUDE_CODE_CREDENTIALS"] = licenseDetectResult.credentials
      }
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

  // Section renderers — kept inline so the form state stays in this component.
  const renderSection = (key: SectionKey) => {
    switch (key) {
      case "general":
        return (
          <GeneralSection
            isMobile={isMobile}
            defaultAgent={defaultAgent}
            setDefaultAgent={setDefaultAgent}
            defaultModel={defaultModel}
            setDefaultModel={setDefaultModel}
            liveFlags={liveFlags}
          />
        )
      case "api-keys":
        return (
          <ApiKeysSection
            isMobile={isMobile}
            credValues={credValues}
            setCredValue={setCredValue}
            highlightKey={highlightKey}
            setInputRef={setInputRef}
            isDesktopApp={isDesktopApp}
            licenseAutoDetectEnabled={licenseAutoDetectEnabled}
            onAutoDetectToggle={handleAutoDetectToggle}
            refreshLicenseDetect={refreshLicenseDetect}
            licenseDetectLoading={licenseDetectLoading}
            licenseDetectResult={licenseDetectResult}
          />
        )
      case "git":
        return (
          <GitSection
            isMobile={isMobile}
            enablePrepushHooks={enablePrepushHooks}
            setEnablePrepushHooks={setEnablePrepushHooks}
          />
        )
      case "appearance":
        return (
          <AppearanceSection
            isMobile={isMobile}
            selectedTheme={selectedTheme}
            onThemeChange={handleThemeChange}
          />
        )
      case "experimental":
        return (
          <ExperimentalSection
            isMobile={isMobile}
            rapidFireMode={rapidFireMode}
            setRapidFireMode={setRapidFireMode}
          />
        )
    }
  }

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
                {sections.map((s) => (
                  <div key={s.key}>{renderSection(s.key)}</div>
                ))}
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
                  {renderSection(activeSection)}
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
