"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Eye, EyeOff, Key, Sun, Moon, Monitor, Bot, ChevronDown, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Settings, Theme, Agent, ModelOption } from "@/lib/types"
import { agentModels, agentLabels, hasCredentialsForModel } from "@/lib/types"
import { getCredentialFlags } from "@/lib/storage"

/** Which API key field to highlight */
export type HighlightKey = "anthropic" | "openai" | "opencode" | "gemini" | null

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onSave: (settings: Settings) => void
  /** Which API key field to highlight with a red outline */
  highlightKey?: HighlightKey
  isMobile?: boolean
}

const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Auto", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

const agents: Agent[] = ["claude-code", "opencode", "codex", "gemini", "goose", "pi", "eliza"]

type SectionKey = "general" | "api-keys" | "appearance"

const sections: { key: SectionKey; label: string; icon: typeof Bot }[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "api-keys", label: "API Keys", icon: Key },
  { key: "appearance", label: "Appearance", icon: Sun },
]

const SWIPE_THRESHOLD = 100 // Minimum swipe distance to dismiss

// API key field component
function ApiKeyField({
  label,
  description,
  value,
  onChange,
  placeholder,
  helpUrl,
  helpText,
  highlight,
  inputRef,
  isMobile,
}: {
  label: string
  description: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  helpUrl?: string
  helpText?: string
  highlight?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  isMobile?: boolean
}) {
  const [showKey, setShowKey] = useState(false)

  return (
    <div>
      <label className={cn(
        "flex items-center gap-2 font-medium mb-1",
        isMobile ? "text-base" : "text-sm",
        highlight ? "text-red-500" : ""
      )}>
        <Key className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        {label}
        {highlight && <span className="text-xs font-normal">(required)</span>}
      </label>
      <p className={cn(
        "text-muted-foreground mb-2",
        isMobile ? "text-sm" : "text-xs"
      )}>
        {description}
        {helpUrl && helpText && (
          <>
            {" "}
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {helpText}
            </a>
          </>
        )}
      </p>
      <div className="relative">
        <input
          ref={inputRef}
          type={showKey ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full pr-10 bg-input border rounded-md focus:outline-none focus:ring-2 font-mono",
            isMobile ? "px-4 py-3 text-base" : "px-3 py-1.5 text-sm",
            highlight
              ? "border-red-500 focus:ring-red-500/50"
              : "border-border focus:ring-ring"
          )}
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors touch-target",
            isMobile ? "right-3 p-2" : "right-2 p-1"
          )}
        >
          {showKey ? (
            <EyeOff className={cn(isMobile ? "h-5 w-5" : "h-3.5 w-3.5")} />
          ) : (
            <Eye className={cn(isMobile ? "h-5 w-5" : "h-3.5 w-3.5")} />
          )}
        </button>
      </div>
    </div>
  )
}

export function SettingsModal({ open, onClose, settings, onSave, highlightKey, isMobile = false }: SettingsModalProps) {
  const { setTheme } = useTheme()

  // Refs for API key inputs
  const anthropicInputRef = useRef<HTMLInputElement>(null)
  const openaiInputRef = useRef<HTMLInputElement>(null)
  const opencodeInputRef = useRef<HTMLInputElement>(null)
  const geminiInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Form state
  const [anthropicApiKey, setAnthropicApiKey] = useState(settings.anthropicApiKey)
  const [openaiApiKey, setOpenaiApiKey] = useState(settings.openaiApiKey)
  const [opencodeApiKey, setOpencodeApiKey] = useState(settings.opencodeApiKey)
  const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey)
  const [defaultAgent, setDefaultAgent] = useState<Agent>(settings.defaultAgent as Agent)
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel)
  const [selectedTheme, setSelectedTheme] = useState<Theme>(settings.theme)
  const [activeSection, setActiveSection] = useState<SectionKey>("general")

  // Swipe to dismiss state (mobile only)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startTime, setStartTime] = useState(0)

  // Get current credentials based on form values
  const currentCredentials = useMemo(() => {
    return getCredentialFlags({
      ...settings,
      anthropicApiKey,
      openaiApiKey,
      opencodeApiKey,
      geminiApiKey,
    })
  }, [anthropicApiKey, openaiApiKey, opencodeApiKey, geminiApiKey, settings])

  // Get available models for the selected agent
  const availableModels = useMemo(() => {
    return agentModels[defaultAgent] ?? []
  }, [defaultAgent])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAnthropicApiKey(settings.anthropicApiKey)
      setOpenaiApiKey(settings.openaiApiKey)
      setOpencodeApiKey(settings.opencodeApiKey)
      setGeminiApiKey(settings.geminiApiKey)
      setDefaultAgent(settings.defaultAgent as Agent)
      setDefaultModel(settings.defaultModel)
      setSelectedTheme(settings.theme)
      setDragY(0)
    }
  }, [open, settings])

  // Switch to API Keys tab when a key is highlighted
  useEffect(() => {
    if (open && highlightKey) {
      setActiveSection("api-keys")
    }
  }, [open, highlightKey])

  // Focus the highlighted API key field when modal opens
  useEffect(() => {
    if (open && highlightKey) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        const refMap = {
          anthropic: anthropicInputRef,
          openai: openaiInputRef,
          opencode: opencodeInputRef,
          gemini: geminiInputRef,
        }
        const ref = refMap[highlightKey]
        if (ref?.current) {
          ref.current.scrollIntoView({ behavior: "smooth", block: "center" })
          ref.current.focus()
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

  // Swipe gesture handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return

    // Only enable swipe when at top of scroll
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

    // Only allow dragging down
    if (diff > 0) {
      setDragY(diff)
    }
  }, [isDragging, startY, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !isMobile) return

    setIsDragging(false)

    const duration = Date.now() - startTime
    const velocity = Math.abs(dragY) / duration

    // Close if dragged far enough or fast enough
    if (dragY > SWIPE_THRESHOLD || velocity > 0.5) {
      onClose()
    }

    setDragY(0)
  }, [isDragging, dragY, startTime, onClose, isMobile])

  // Apply theme immediately when changed
  const handleThemeChange = (theme: Theme) => {
    setSelectedTheme(theme)
    setTheme(theme)
  }

  const handleSave = () => {
    onSave({
      anthropicApiKey,
      openaiApiKey,
      opencodeApiKey,
      geminiApiKey,
      defaultAgent,
      defaultModel,
      theme: selectedTheme,
    })
    onClose()
  }

  const hasChanges =
    anthropicApiKey !== settings.anthropicApiKey ||
    openaiApiKey !== settings.openaiApiKey ||
    opencodeApiKey !== settings.opencodeApiKey ||
    geminiApiKey !== settings.geminiApiKey ||
    defaultAgent !== settings.defaultAgent ||
    defaultModel !== settings.defaultModel ||
    selectedTheme !== settings.theme

  // Section content blocks (reused across desktop and mobile layouts)
  const generalSection = (
    <div className={cn(isMobile ? "space-y-4" : "space-y-4")}>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base">
          <Bot className="h-5 w-5" />
          Default Agent
        </h3>
      )}

      <div>
        <label className={cn(
          "text-muted-foreground mb-1 block",
          isMobile ? "text-sm" : "text-xs"
        )}>Agent</label>
        <div className="relative">
          <select
            value={defaultAgent}
            onChange={(e) => setDefaultAgent(e.target.value as Agent)}
            className={cn(
              "w-full bg-input border border-border rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-ring",
              isMobile ? "px-4 py-3 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agentLabels[agent]}
              </option>
            ))}
          </select>
          <ChevronDown className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            isMobile ? "right-4 h-5 w-5" : "right-2 h-4 w-4"
          )} />
        </div>
      </div>

      <div>
        <label className={cn(
          "text-muted-foreground mb-1 block",
          isMobile ? "text-sm" : "text-xs"
        )}>Model</label>
        <div className="relative">
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className={cn(
              "w-full bg-input border border-border rounded-md appearance-none focus:outline-none focus:ring-2 focus:ring-ring",
              isMobile ? "px-4 py-3 text-base" : "px-3 py-1.5 text-sm"
            )}
          >
            {availableModels.map((model: ModelOption) => {
              const hasCredentials = hasCredentialsForModel(model, currentCredentials, defaultAgent)
              return (
                <option key={model.value} value={model.value}>
                  {model.label}
                  {!hasCredentials && model.requiresKey !== "none" ? " (needs API key)" : ""}
                </option>
              )
            })}
          </select>
          <ChevronDown className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            isMobile ? "right-4 h-5 w-5" : "right-2 h-4 w-4"
          )} />
        </div>
      </div>
    </div>
  )

  const apiKeysSection = (
    <div className={cn(isMobile ? "space-y-4" : "space-y-4")}>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base">
          <Key className="h-5 w-5" />
          API Keys
        </h3>
      )}
      <p className={cn(
        "text-muted-foreground",
        isMobile ? "text-sm" : "text-xs"
      )}>
        Add API keys to unlock more models. All keys are stored locally in your browser.
      </p>

      <ApiKeyField
        label="Anthropic"
        description="For Claude Code and Claude models."
        value={anthropicApiKey}
        onChange={setAnthropicApiKey}
        placeholder="sk-ant-..."
        helpUrl="https://console.anthropic.com/"
        helpText="Get key"
        highlight={highlightKey === "anthropic"}
        inputRef={anthropicInputRef}
        isMobile={isMobile}
      />

      <ApiKeyField
        label="OpenAI"
        description="For Codex, GPT models, and Goose."
        value={openaiApiKey}
        onChange={setOpenaiApiKey}
        placeholder="sk-..."
        helpUrl="https://platform.openai.com/api-keys"
        helpText="Get key"
        highlight={highlightKey === "openai"}
        inputRef={openaiInputRef}
        isMobile={isMobile}
      />

      <ApiKeyField
        label="OpenCode"
        description="For paid OpenCode models."
        value={opencodeApiKey}
        onChange={setOpencodeApiKey}
        placeholder="..."
        highlight={highlightKey === "opencode"}
        inputRef={opencodeInputRef}
        helpUrl="https://opencode.ai/auth"
        helpText="Get key"
        isMobile={isMobile}
      />

      <ApiKeyField
        label="Google AI (Gemini)"
        description="For Gemini models."
        value={geminiApiKey}
        onChange={setGeminiApiKey}
        placeholder="..."
        helpUrl="https://aistudio.google.com/apikey"
        helpText="Get key"
        highlight={highlightKey === "gemini"}
        inputRef={geminiInputRef}
        isMobile={isMobile}
      />
    </div>
  )

  const appearanceSection = (
    <div className={cn(isMobile ? "space-y-4" : "space-y-3")}>
      {isMobile && (
        <h3 className="flex items-center gap-2 font-semibold text-base">
          <Sun className="h-5 w-5" />
          Theme
        </h3>
      )}
      <div className="flex gap-2">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => handleThemeChange(value)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 rounded-md border transition-colors",
              isMobile ? "px-4 py-3 text-base touch-target" : "px-3 py-2 text-sm cursor-pointer",
              selectedTheme === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-accent active:bg-accent"
            )}
          >
            <Icon className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
            {label}
          </button>
        ))}
      </div>
    </div>
  )

  const activeTitle = sections.find((s) => s.key === activeSection)?.label ?? "Settings"

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-0 bottom-0 top-0 rounded-none"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-[600px] max-h-[85vh] border border-border rounded-xl shadow-lg",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? {
            transform: `translateY(${dragY}px)`,
          } : undefined}
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
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-popover px-4 py-4 pb-safe">
                <button
                  onClick={onClose}
                  className="rounded-md hover:bg-accent active:bg-accent transition-colors touch-target px-6 py-3 text-base"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-target px-6 py-3 text-base"
                >
                  Save
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

                <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
                  <button
                    onClick={onClose}
                    className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges}
                    className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-1.5 text-sm cursor-pointer"
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
