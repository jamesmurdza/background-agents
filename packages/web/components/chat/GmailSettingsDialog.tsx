"use client"

/**
 * GmailSettingsDialog — per-connection Gmail scoping (access preset, individual
 * tools, recipient allowlist, label scope) plus the Google account unlink.
 * Changes are edited locally and saved together; /api/mcp/gmail enforces the
 * saved policy on the agent's next tool call.
 */

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { AlertCircle, Unlink } from "lucide-react"
import {
  GMAIL_POLICY_PRESETS,
  GMAIL_TOOL_NAMES,
  type GmailToolName,
  type GmailToolPolicy,
} from "@background-agents/mcp/gmail/policy"
import { GmailIcon } from "@/components/icons/gmail-icon"
import { DialogFooter } from "@/components/ui/dialog-parts"
import { Input } from "@/components/ui/input"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"

const PRESET_OPTIONS: { label: string; description: string; tools: GmailToolName[] }[] = [
  {
    label: "Read only",
    description: "Search and read",
    tools: GMAIL_POLICY_PRESETS.readOnly.allowedTools,
  },
  {
    label: "Read + draft",
    description: "Drafts for you to send",
    tools: GMAIL_POLICY_PRESETS.readDraft.allowedTools,
  },
  {
    label: "Full access",
    description: "Send and relabel too",
    tools: GMAIL_POLICY_PRESETS.full.allowedTools,
  },
]

const TOOL_INFO: Record<GmailToolName, { label: string; description: string }> = {
  search_threads: { label: "Search threads", description: "Find threads with Gmail search syntax" },
  get_thread: { label: "Read threads", description: "Open a thread's messages, headers and labels" },
  list_labels: { label: "List labels", description: "See the mailbox's label names" },
  create_draft: { label: "Create drafts", description: "Write drafts; nothing is sent" },
  update_draft: { label: "Edit drafts", description: "Replace a draft's contents; nothing is sent" },
  delete_draft: { label: "Delete drafts", description: "Permanently delete drafts" },
  send_message: { label: "Send email", description: "Send mail without your review" },
  modify_thread_labels: { label: "Change labels", description: "Add or remove labels on threads" },
}

function sameTools(a: GmailToolName[], b: GmailToolName[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t))
}

function parseRecipients(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean)
}

interface GmailSettingsDialogProps {
  open: boolean
  onClose: () => void
  /** Saved policy of this chat's/job's Gmail row; null when Gmail isn't attached. */
  policy: GmailToolPolicy | null
  /** Persists the policy; rejects with a user-facing message on failure. */
  onSave: (policy: GmailToolPolicy) => Promise<void>
  /** Shown when the Google account is linked; asks to unlink it everywhere. */
  onDisconnectAccount?: () => void
  /** "chat" or "scheduled job", for copy. */
  entityLabel: string
  isMobile?: boolean
}

export function GmailSettingsDialog({
  open,
  onClose,
  policy,
  onSave,
  onDisconnectAccount,
  entityLabel,
  isMobile = false,
}: GmailSettingsDialogProps) {
  const [tools, setTools] = useState<GmailToolName[]>([])
  const [recipients, setRecipients] = useState("")
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  // Reset the draft from the saved policy each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setTools(policy?.allowedTools ?? [])
    setRecipients(policy?.allowedRecipients?.join(", ") ?? "")
    setLabel(policy?.restrictToLabel ?? "")
    setError(null)
    setSaving(false)
  }, [open, policy])

  const draft: GmailToolPolicy | null = policy && {
    ...policy,
    // Keep the canonical tool order regardless of toggle order.
    allowedTools: GMAIL_TOOL_NAMES.filter((t) => tools.includes(t)),
    allowedRecipients: parseRecipients(recipients).length > 0 ? parseRecipients(recipients) : undefined,
    restrictToLabel: label.trim() || undefined,
  }

  const dirty =
    !!policy &&
    !!draft &&
    (!sameTools(policy.allowedTools, draft.allowedTools) ||
      (policy.allowedRecipients ?? []).join(",") !== (draft.allowedRecipients ?? []).join(",") ||
      (policy.restrictToLabel ?? "") !== (draft.restrictToLabel ?? ""))

  const activePreset = PRESET_OPTIONS.find((p) => sameTools(tools, p.tools))
  const canSend = tools.includes("send_message")

  function toggleTool(tool: GmailToolName) {
    setTools((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]))
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save Gmail settings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={MODAL_OVERLAY_CLASS} />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col overflow-hidden",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md max-h-[min(640px,85vh)] border border-border rounded-xl shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          <div {...dragHandlers}>
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
            )}
            <ModalHeader
              title={
                <>
                  <GmailIcon className="h-4 w-4" />
                  Gmail settings
                </>
              }
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5 text-sm">
            {draft ? (
              <>
                <section aria-labelledby="gmail-access-heading">
                  <SectionHeading id="gmail-access-heading">
                    Access
                    {!activePreset && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                        Custom
                      </span>
                    )}
                  </SectionHeading>
                  <div role="radiogroup" aria-labelledby="gmail-access-heading" className="grid grid-cols-3 gap-1.5">
                    {PRESET_OPTIONS.map((preset) => {
                      const selected = preset === activePreset
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setTools(preset.tools)}
                          className={cn(
                            "rounded-lg border px-2 py-2 text-left transition-colors cursor-pointer",
                            selected
                              ? "border-primary/50 bg-primary/10"
                              : "border-border hover:bg-accent"
                          )}
                        >
                          <div className={cn("text-xs font-medium", selected && "text-primary")}>
                            {preset.label}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                            {preset.description}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section aria-labelledby="gmail-tools-heading">
                  <SectionHeading id="gmail-tools-heading">Tools</SectionHeading>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {GMAIL_TOOL_NAMES.map((tool) => (
                      <ToolSwitchRow
                        key={tool}
                        label={TOOL_INFO[tool].label}
                        description={TOOL_INFO[tool].description}
                        checked={tools.includes(tool)}
                        warn={tool === "send_message"}
                        onToggle={() => toggleTool(tool)}
                      />
                    ))}
                  </div>
                  {tools.length === 0 && (
                    <p className="mt-1.5 text-xs text-destructive">
                      Enable at least one tool, or remove Gmail from this {entityLabel}.
                    </p>
                  )}
                </section>

                <section aria-labelledby="gmail-limits-heading" className="space-y-3">
                  <SectionHeading id="gmail-limits-heading">Limits</SectionHeading>
                  <Field
                    id="gmail-recipients"
                    label="Allowed recipients"
                    hint={
                      canSend
                        ? "Addresses or @domain, comma-separated. Leave empty to allow anyone."
                        : "Applies to sent mail, which is currently off."
                    }
                  >
                    <Input
                      id="gmail-recipients"
                      value={recipients}
                      onChange={(e) => setRecipients(e.target.value)}
                      placeholder="Anyone"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    id="gmail-label"
                    label="Restrict to label"
                    hint="Only threads with this exact Gmail label. Leave empty for the whole mailbox."
                  >
                    <Input
                      id="gmail-label"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Whole mailbox"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                </section>
              </>
            ) : (
              <p className="text-muted-foreground">
                Gmail isn&apos;t attached to this {entityLabel}. Select it in the MCP list to
                attach it, then come back here to choose what the agent can do.
              </p>
            )}

            {onDisconnectAccount && (
              <section
                aria-labelledby="gmail-account-heading"
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div id="gmail-account-heading" className="font-medium">Google account</div>
                  <div className="text-xs text-muted-foreground">
                    Unlinking removes Gmail from every chat and scheduled job.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onDisconnectAccount}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                  Disconnect
                </button>
              </section>
            )}
          </div>

          {draft && (
            <div className="border-t border-border px-4 pb-3">
              {error && (
                <div
                  role="alert"
                  className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {error}
                </div>
              )}
              <DialogFooter
                onCancel={onClose}
                onAction={handleSave}
                actionLabel="Save"
                disabled={!dirty || tools.length === 0}
                loading={saving}
                isMobile={isMobile}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="mb-2 flex items-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </h3>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function ToolSwitchRow({
  label,
  description,
  checked,
  warn,
  onToggle,
}: {
  label: string
  description: string
  checked: boolean
  /** Highlights a tool that acts without the user's review when it's on. */
  warn?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors cursor-pointer first:rounded-t-lg last:rounded-b-lg"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className={cn("text-xs", warn && checked ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
          {description}
        </div>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "h-3 w-3 rounded-full bg-background transition-transform",
            checked ? "translate-x-3" : "translate-x-0"
          )}
        />
      </span>
    </button>
  )
}
