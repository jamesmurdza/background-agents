"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTheme } from "next-themes"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Eye, EyeOff, Key, Sun, Moon, Monitor, Bot, ChevronDown, Settings as SettingsIcon, Terminal, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Settings, Theme, Agent, ModelOption } from "@/lib/types"
import { agentModels, agentLabels, hasCredentialsForModel } from "@/lib/types"
import { getCredentialFlags } from "@/lib/storage"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  inputRef?: React.RefObject<HTMLInputElement | null>
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
  const [anthropicAuthToken, setAnthropicAuthToken] = useState(settings.anthropicAuthToken)
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
      anthropicAuthToken,
      openaiApiKey,
      opencodeApiKey,
      geminiApiKey,
    })
  }, [anthropicApiKey, anthropicAuthToken, openaiApiKey, opencodeApiKey, geminiApiKey, settings])

  // Get available models for the selected agent
  const availableModels = useMemo(() => {
    return agentModels[defaultAgent] ?? []
  }, [defaultAgent])

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAnthropicApiKey(settings.anthropicApiKey)
      setAnthropicAuthToken(settings.anthropicAuthToken)
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
      anthropicAuthToken,
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
    anthropicAuthToken !== settings.anthropicAuthToken ||
    openaiApiKey !== settings.openaiApiKey ||
    opencodeApiKey !== settings.opencodeApiKey ||
    geminiApiKey !== settings.geminiApiKey ||
    defaultAgent !== settings.defaultAgent ||
    defaultModel !== settings.defaultModel ||
    selectedTheme !== settings.theme

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
            {agents.map((agent) => (
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
              const hasCredentials = hasCredentialsForModel(model, currentCredentials, defaultAgent)
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
      <SettingsRow
        label="Anthropic"
        description={renderHelpLink("https://console.anthropic.com/")}
      >
        <PasswordInput
          value={anthropicApiKey}
          onChange={setAnthropicApiKey}
          placeholder="sk-ant-..."
          highlight={highlightKey === "anthropic"}
          inputRef={anthropicInputRef}
        />
      </SettingsRow>
      <SettingsRow
        label="Claude Subscription"
        description="Claude Code only."
        stacked
      >
        <Textarea
          value={anthropicAuthToken}
          onChange={(e) => setAnthropicAuthToken(e.target.value)}
          placeholder='{"claudeAiOauth":{"token_type":"bearer",...}}'
          rows={3}
          autoComplete="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          className="font-mono text-xs"
        />
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <p>
            First sign in with <CopyCode text="claude auth login" />
          </p>
          <p>
            Then paste the output of{" "}
            <CopyCode text={'security find-generic-password -s "Claude Code-credentials" -w'} />
          </p>
        </div>
      </SettingsRow>
      <SettingsRow
        label="OpenAI"
        description={renderHelpLink("https://platform.openai.com/api-keys")}
      >
        <PasswordInput
          value={openaiApiKey}
          onChange={setOpenaiApiKey}
          placeholder="sk-..."
          highlight={highlightKey === "openai"}
          inputRef={openaiInputRef}
        />
      </SettingsRow>
      <SettingsRow
        label="OpenCode"
        description={renderHelpLink("https://opencode.ai/auth")}
      >
        <PasswordInput
          value={opencodeApiKey}
          onChange={setOpencodeApiKey}
          placeholder="..."
          highlight={highlightKey === "opencode"}
          inputRef={opencodeInputRef}
        />
      </SettingsRow>
      <SettingsRow
        label="Google AI (Gemini)"
        description={renderHelpLink("https://aistudio.google.com/apikey")}
      >
        <PasswordInput
          value={geminiApiKey}
          onChange={setGeminiApiKey}
          placeholder="..."
          highlight={highlightKey === "gemini"}
          inputRef={geminiInputRef}
        />
      </SettingsRow>
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
