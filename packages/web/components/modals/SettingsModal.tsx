"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Key, Sun, Bot, Settings as SettingsIcon, GitBranch, FolderDown, Bell, Gauge, Server, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { useElectron, type LicenseDetectResult } from "@/lib/hooks/useElectron"
import type { Settings, Theme, Agent, Credentials, CredentialFlags, CustomEndpoint } from "@/lib/types"
import { agentModels, resolveAgent, getDefaultModelForAgent } from "@/lib/types"
import {
  CREDENTIAL_KEYS,
  type CredentialId,
} from "@/lib/credentials"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import {
  GeneralSection,
  ApiKeysSection,
  CustomEndpointsSection,
  UsageSection,
  GitSection,
  NotificationsSection,
  LocalSyncSection,
  AppearanceSection,
  DeveloperSection,
  initialCredValues,
  MASK,
  type HighlightKey,
} from "./settings"

// Re-export so existing callers keep working.
export type { HighlightKey }

/** Settings modal section identifier */
export type SectionKey = "general" | "api-keys" | "custom-endpoints" | "usage" | "git" | "notifications" | "local-sync" | "appearance" | "developer"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  credentialFlags: CredentialFlags
  onSave: (data: {
    settings?: Partial<Settings>
    credentials?: Credentials
    customEndpoints?: CustomEndpoint[]
  }) => Promise<{ ok: boolean; error?: string }>
  /** Which provider's first API key field to highlight with a red outline */
  highlightKey?: HighlightKey
  /** Which section to show by default */
  defaultSection?: SectionKey
  /** Called if the modal is dismissed without providing the highlighted key. */
  onDismissWithoutKey?: (() => void) | null
  isMobile?: boolean
}

type SectionDef = { key: SectionKey; label: string; icon: typeof Bot }

const baseSections: SectionDef[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "api-keys", label: "API Keys", icon: Key },
  { key: "custom-endpoints", label: "Custom endpoints", icon: Server },
  { key: "usage", label: "Usage", icon: Gauge },
  { key: "appearance", label: "Appearance", icon: Sun },
  { key: "git", label: "Git", icon: GitBranch },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "developer", label: "Developer", icon: Wrench },
]

const localSyncSection: SectionDef = { key: "local-sync", label: "Local Sync", icon: FolderDown }

/** The "Local Sync" tab is desktop-only; the web app never shows it. */
function getSections(isDesktopApp: boolean): SectionDef[] {
  if (!isDesktopApp) return baseSections
  const out = [...baseSections]
  const gitIndex = out.findIndex((s) => s.key === "git")
  out.splice(gitIndex + 1, 0, localSyncSection)
  return out
}

export function SettingsModal({ open, onClose, settings, credentialFlags, onSave, highlightKey, defaultSection = "general", onDismissWithoutKey, isMobile = false }: SettingsModalProps) {
  const { setTheme } = useTheme()
  const { isDesktopApp, getClaudeLicenseAutoDetect, getLicenseDetectSettings, setLicenseDetectSettings } = useElectron()

  // The user's custom endpoints (headers decrypted for editing), from the shared
  // settings query cache. Edited locally and persisted on Save.
  const { data: settingsData } = useSettingsQuery()
  const initialEndpoints = useMemo<CustomEndpoint[]>(
    () => settingsData?.customEndpoints ?? [],
    [settingsData?.customEndpoints]
  )

  // The "Local Sync" tab only exists in the desktop app.
  const sections = useMemo(() => getSections(isDesktopApp), [isDesktopApp])

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
  const initialCreds = useMemo(
    () => initialCredValues(credentialFlags),
    [credentialFlags]
  )

  // Working copy of the custom-endpoint list, edited in the Custom endpoints tab.
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>(initialEndpoints)

  // Resolve null preference against current credential flags so the dropdown
  // shows whatever new chats would actually use. Snapshotted off saved flags
  // (not in-form values) so it doesn't drift while the user types keys.
  const initialDefaultAgent = useMemo<Agent>(
    () => resolveAgent(settings.defaultAgent, undefined),
    [settings.defaultAgent]
  )
  const initialDefaultModel = useMemo<string>(
    () => settings.defaultModel ?? getDefaultModelForAgent(initialDefaultAgent, credentialFlags),
    [settings.defaultModel, initialDefaultAgent, credentialFlags]
  )

  const [defaultAgent, setDefaultAgent] = useState<Agent>(initialDefaultAgent)
  const [defaultModel, setDefaultModel] = useState(initialDefaultModel)
  const [selectedTheme, setSelectedTheme] = useState<Theme>(settings.theme)
  const [enablePrepushHooks, setEnablePrepushHooks] = useState(settings.enablePrepushHooks)
  const [notifyOnAgentFinished, setNotifyOnAgentFinished] = useState(settings.notifyOnAgentFinished)
  const [notifyOnAgentCommitted, setNotifyOnAgentCommitted] = useState(settings.notifyOnAgentCommitted)
  const [notificationSound, setNotificationSound] = useState(settings.notificationSound)
  const [elizaEnabled, setElizaEnabled] = useState(settings.elizaEnabled)
  const [activeSection, setActiveSection] = useState<SectionKey>(defaultSection)

  // Drag to dismiss (mobile only). Routed through a ref so it persists pending
  // changes via handleClose (defined below) rather than discarding them.
  const handleCloseRef = useRef<() => void>(() => {})
  const { handlers: dragHandlers, dragY, isDragging, dragRef } = useDragToClose({
    onClose: () => handleCloseRef.current(),
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
      setEndpoints(initialEndpoints)
      setDefaultAgent(initialDefaultAgent)
      setDefaultModel(initialDefaultModel)
      setSelectedTheme(settings.theme)
      setEnablePrepushHooks(settings.enablePrepushHooks)
      setNotifyOnAgentFinished(settings.notifyOnAgentFinished)
      setNotifyOnAgentCommitted(settings.notifyOnAgentCommitted)
      setNotificationSound(settings.notificationSound)
      setElizaEnabled(settings.elizaEnabled)
      setActiveSection(defaultSection)
    }
  }, [open, settings, credentialFlags, initialEndpoints, initialDefaultAgent, initialDefaultModel, defaultSection])

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

  const endpointsChanged = useMemo(
    () => JSON.stringify(endpoints) !== JSON.stringify(initialEndpoints),
    [endpoints, initialEndpoints]
  )

  // Collect all pending changes into a single save payload, or null if nothing
  // changed. There is no explicit Save button — settings persist automatically
  // when the modal closes (see handleClose).
  const buildSaveData = useCallback((): Parameters<typeof onSave>[0] | null => {
    const settingsPatch: Partial<Settings> = {}
    if (defaultAgent !== initialDefaultAgent) settingsPatch.defaultAgent = defaultAgent
    if (defaultModel !== initialDefaultModel) settingsPatch.defaultModel = defaultModel
    if (selectedTheme !== settings.theme) settingsPatch.theme = selectedTheme
    if (enablePrepushHooks !== settings.enablePrepushHooks) settingsPatch.enablePrepushHooks = enablePrepushHooks
    if (notifyOnAgentFinished !== settings.notifyOnAgentFinished) settingsPatch.notifyOnAgentFinished = notifyOnAgentFinished
    if (notifyOnAgentCommitted !== settings.notifyOnAgentCommitted) settingsPatch.notifyOnAgentCommitted = notifyOnAgentCommitted
    if (notificationSound !== settings.notificationSound) settingsPatch.notificationSound = notificationSound
    if (elizaEnabled !== settings.elizaEnabled) settingsPatch.elizaEnabled = elizaEnabled

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
      // Only include if user hasn't manually entered a different value.
      // Treat an explicit empty string as a CLEAR request and do NOT override it.
      const manualValue = credValues["CLAUDE_CODE_CREDENTIALS"]
      if (
        manualValue === MASK ||
        manualValue === initialCreds["CLAUDE_CODE_CREDENTIALS"]
      ) {
        credentialsPatch["CLAUDE_CODE_CREDENTIALS"] = licenseDetectResult.credentials
      }
    }

    const data: Parameters<typeof onSave>[0] = {}
    if (Object.keys(settingsPatch).length > 0) data.settings = settingsPatch
    if (Object.keys(credentialsPatch).length > 0) data.credentials = credentialsPatch
    // Persist endpoints only when they're all valid (name + base URL always,
    // plus a model for OpenCode). A half-finished endpoint is simply not saved.
    const badEndpoint = endpoints.find(
      (e) => !e.name.trim() || !e.baseUrl.trim() || (e.type === "opencode" && !e.model.trim())
    )
    if (endpointsChanged && !badEndpoint) data.customEndpoints = endpoints

    return Object.keys(data).length > 0 ? data : null
  }, [
    defaultAgent, initialDefaultAgent, defaultModel, initialDefaultModel,
    selectedTheme, enablePrepushHooks, notifyOnAgentFinished, notifyOnAgentCommitted,
    notificationSound, elizaEnabled, settings, credValues, initialCreds,
    isDesktopApp, licenseAutoDetectEnabled, licenseDetectResult, endpoints, endpointsChanged,
  ])

  // Persist any pending changes (fire-and-forget) and close. This replaces the
  // explicit Save button — closing the modal is what commits the edits.
  const handleClose = useCallback(() => {
    const data = buildSaveData()
    if (data) void onSave(data)
    // If the modal was opened to collect a required API key (highlightKey) and
    // the user closed it without entering one, run the revert callback (e.g.
    // restore the previously-selected agent that didn't need a key).
    if (highlightKey && onDismissWithoutKey) {
      const target = CREDENTIAL_KEYS.find((c) => c.provider === highlightKey)
      const entered = target ? credValues[target.id] : undefined
      const provided = !!entered && entered !== MASK
      if (!provided) onDismissWithoutKey()
    }
    onClose()
  }, [buildSaveData, onSave, onClose, highlightKey, onDismissWithoutKey, credValues])
  // Keep the drag-to-dismiss ref pointing at the latest handleClose.
  handleCloseRef.current = handleClose

  const setCredValue = useCallback((id: CredentialId, value: string) => {
    setCredValues((prev) => ({ ...prev, [id]: value }))
  }, [])

  // Cmd/Ctrl+Enter closes (and thereby saves) the modal.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleClose()
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
            elizaEnabled={elizaEnabled}
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
      case "custom-endpoints":
        return (
          <CustomEndpointsSection
            isMobile={isMobile}
            endpoints={endpoints}
            setEndpoints={setEndpoints}
          />
        )
      case "usage":
        return <UsageSection isMobile={isMobile} />
      case "git":
        return (
          <GitSection
            isMobile={isMobile}
            enablePrepushHooks={enablePrepushHooks}
            setEnablePrepushHooks={setEnablePrepushHooks}
          />
        )
      case "notifications":
        return (
          <NotificationsSection
            isMobile={isMobile}
            notifyOnAgentFinished={notifyOnAgentFinished}
            setNotifyOnAgentFinished={setNotifyOnAgentFinished}
            notifyOnAgentCommitted={notifyOnAgentCommitted}
            setNotifyOnAgentCommitted={setNotifyOnAgentCommitted}
            notificationSound={notificationSound}
            setNotificationSound={setNotificationSound}
          />
        )
      case "local-sync":
        return <LocalSyncSection isMobile={isMobile} />
      case "appearance":
        return (
          <AppearanceSection
            isMobile={isMobile}
            selectedTheme={selectedTheme}
            onThemeChange={handleThemeChange}
          />
        )
      case "developer":
        return (
          <DeveloperSection
            isMobile={isMobile}
            elizaEnabled={elizaEnabled}
            setElizaEnabled={setElizaEnabled}
          />
        )
    }
  }

  const activeTitle = sections.find((s) => s.key === activeSection)?.label ?? "Settings"

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
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
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl h-[600px] max-h-[85vh] border border-border rounded-xl shadow-xl",
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
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
