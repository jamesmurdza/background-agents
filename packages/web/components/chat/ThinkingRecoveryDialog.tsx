"use client"

import { useEffect, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { supportsThinking, thinkingLabel } from "@background-agents/sdk/thinking"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useThinkingPreference } from "@/lib/hooks/useThinkingPreference"
import { agentLabels, getModelLabel, type Agent } from "@/lib/types"
import {
  canConfirmThinkingRecovery, recoveryTargetKey,
  type ThinkingRecoveryChoice, type ThinkingRecoveryRequest,
} from "@/lib/thinking-recovery"
import { ThinkingSelector } from "./ThinkingSelector"

/** Mount only while a recovery is pending. A choice belongs to its exact
 * recovery target, never to mutable composer settings or an old queue item. */
export function ThinkingRecoveryDialog({ request, sandboxId, readinessKey, onCancel, onConfirm }: {
  request: ThinkingRecoveryRequest
  sandboxId?: string | null
  readinessKey?: string
  onCancel: () => void
  onConfirm: (requestId: string, thinking: string) => void | Promise<void | { status: "accepted" | "blocked"; message?: string }>
}) {
  const preference = useThinkingPreference(request.agent, request.model, request.chatId, sandboxId, { readinessKey })
  const [choice, setChoice] = useState<ThinkingRecoveryChoice>()
  const [confirming, setConfirming] = useState(false)
  const [dispatchNotice, setDispatchNotice] = useState<string>()
  const targetKey = recoveryTargetKey(request)
  const submitted = useRef(false)
  const latest = useRef({ request, choice, preference })
  latest.current = { request, choice, preference }

  useEffect(() => {
    setChoice(undefined)
    setDispatchNotice(undefined)
    setConfirming(false)
    submitted.current = false
    // Keep the old intent visible, including when unsupported on the new
    // target. Only an explicit user choice can replace it with Default.
    preference.requestThinking(request.originalThinking)
    // The request is an immutable snapshot; menu discovery must not reset a
    // user's subsequent choice when its response arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  const targetName = `${agentLabels[request.agent as Agent] ?? request.agent} · ${getModelLabel(request.agent as Agent, request.model)}`
  const originalName = request.originalAgent && request.originalModel
    ? `${agentLabels[request.originalAgent as Agent] ?? request.originalAgent} · ${getModelLabel(request.originalAgent as Agent, request.originalModel)}`
    : "Unknown (not recorded on this older message)"
  const canConfirm = canConfirmThinkingRecovery(request, choice, preference.capability, preference.ready)

  const choose = (thinking: string) => {
    if (submitted.current || !supportsThinking(preference.capability, thinking)) return
    // This is consent for one retry, not a change to the composer's saved
    // per-model preference (including when the user later cancels).
    preference.requestThinking(thinking)
    setChoice({ targetKey, thinking })
  }
  const cancel = () => { if (!submitted.current) onCancel() }
  const confirm = async () => {
    const current = latest.current
    // Ignore a stale click handler after navigation, model change or a newer
    // discovery result removed the selected capability.
    if (submitted.current || recoveryTargetKey(current.request) !== targetKey ||
      !canConfirmThinkingRecovery(current.request, current.choice, current.preference.capability, current.preference.ready)) return
    submitted.current = true
    setConfirming(true)
    setDispatchNotice(undefined)
    try {
      const result = await onConfirm(request.id, current.choice!.thinking)
      if (recoveryTargetKey(latest.current.request) !== targetKey) return
      if (result?.status === "blocked") {
        submitted.current = false
        setDispatchNotice(result.message ?? "This retry could not start. Your prompt and attachments are kept; try again when the chat is available.")
      }
    } catch (error) {
      console.error("[thinking-recovery] Retry confirmation failed", error instanceof Error ? error.message : "Unknown error")
      // An unexpected exception is not proof that no POST was sent. Keep the
      // request visible, but do not unlock a second send into an uncertain run.
      setDispatchNotice("Could not confirm the retry. Reload to check the saved chat before sending again.")
    } finally {
      if (recoveryTargetKey(latest.current.request) === targetKey) setConfirming(false)
    }
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) cancel() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]" />
      <Dialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-xl"
        onCloseAutoFocus={event => { event.preventDefault(); focusChatPrompt() }}
      >
        <ModalHeader title="Review thinking before retrying" />
        <div className="space-y-4 px-4 py-4 text-sm">
          <Dialog.Description className="text-muted-foreground">
            This retry uses a different agent or model, or the original model was not recorded. Choose its thinking setting before sending. Retries are never sent automatically.
          </Dialog.Description>
          <dl className="space-y-1 break-words">
            <div><dt className="inline text-muted-foreground">Original: </dt><dd className="inline">{originalName} · {thinkingLabel(request.originalThinking)}</dd></div>
            <div><dt className="inline text-muted-foreground">Retry with: </dt><dd className="inline">{targetName}</dd></div>
          </dl>
          <ThinkingSelector capability={preference.capability} value={preference.thinking} onChange={choose}
            checking={preference.checking}
            onRetry={preference.canRecheck ? preference.recheckThinking : undefined} onOpenChange={preference.onThinkingMenuOpen} />
          {preference.notice && <p role="status" className="text-xs text-muted-foreground">{preference.notice}</p>}
          <div className="flex flex-wrap gap-3">
            {preference.thinking !== "default" && supportsThinking(preference.capability, preference.thinking) &&
              <button type="button" onClick={() => choose(preference.thinking)} className="text-sm underline underline-offset-2">
                Use {thinkingLabel(preference.thinking)} for this retry
              </button>}
            <button type="button" onClick={() => choose("default")} className="text-sm underline underline-offset-2">
              Use Default for this retry
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Default uses the new agent/model's native setting. It does not preserve the previous thinking level. Queued prompts keep their original settings.</p>
          {!!request.files?.length && <p className="text-xs text-muted-foreground">Attachments retained: {request.files.map(file => file.name).join(", ")}</p>}
          {!!request.missingAttachments?.length && <p role="alert" className="text-xs text-destructive">Previously uploaded files cannot be reattached by Retry: {request.missingAttachments.join(", ")}. Cancel and attach them in the composer if this prompt needs them.</p>}
          {confirming && <p role="status" className="text-xs text-muted-foreground">Checking and sending this retry…</p>}
          {dispatchNotice && <p role="alert" className="text-xs text-destructive">{dispatchNotice}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={submitted.current} onClick={cancel} className="rounded border px-3 py-2 disabled:opacity-50">Cancel</button>
            <button type="button" disabled={!canConfirm || submitted.current} onClick={confirm} className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">
              Confirm and retry
            </button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
