"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useModals } from "@/lib/contexts"
import { AgentIcon } from "@/components/icons/agent-icons"
import { ALL_AGENTS, agentToProvider, type Agent } from "@background-agents/common"
import type { ChatUsageResponse } from "@/app/api/chats/[chatId]/usage/route"
import { fmtTokens } from "@/lib/format"

/** Reverse map: SDK provider id → agent (for the provider's icon). */
const PROVIDER_TO_AGENT: Record<string, Agent> = Object.fromEntries(
  ALL_AGENTS.map((agent) => [agentToProvider[agent], agent])
)

/** Render a usage amount in its budget unit (tokens / USD cost / messages). */
function fmtUsage(value: number, unit: ChatUsageResponse["providers"][number]["unit"]) {
  if (unit === "cost") return <>${value.toFixed(2)}</>
  if (unit === "messages")
    return (
      <>
        {Math.round(value)}
        <span className="text-muted-foreground"> {Math.round(value) === 1 ? "message" : "messages"}</span>
      </>
    )
  return (
    <>
      {fmtTokens(value)}
      <span className="text-muted-foreground"> tokens</span>
    </>
  )
}

interface ChatUsageModalProps {
  /** Chat to show usage for; null when the modal is closed. */
  chatId: string | null
  onClose: () => void
  isMobile?: boolean
}

/**
 * Per-chat token usage, broken down by provider with a grand total. Opened from
 * the command palette. Links to the Usage settings tab for shared-pool budgets.
 */
export function ChatUsageModal({ chatId, onClose, isMobile = false }: ChatUsageModalProps) {
  const modals = useModals()
  const open = chatId !== null
  const [data, setData] = useState<ChatUsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!chatId) return
    let cancelled = false
    setData(null)
    setError(null)
    fetch(`/api/chats/${chatId}/usage`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load usage (${res.status})`)
        return (await res.json()) as ChatUsageResponse
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load usage")
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader title="Chat token usage" />
          <div className="px-4 pt-3 pb-4 space-y-3">
            {error ? (
              <div className="text-sm text-destructive py-2">{error}</div>
            ) : !data ? (
              <div className="space-y-2 py-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-4 w-full rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : data.providers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                No tokens recorded for this chat yet.
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {data.providers.map((p) => {
                  const agent = PROVIDER_TO_AGENT[p.provider]
                  return (
                    <div key={p.provider} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2 text-sm">
                        {agent && <AgentIcon agent={agent} className="h-4 w-4 shrink-0" />}
                        {p.label}
                      </span>
                      <span className="text-sm font-medium tabular-nums">
                        {fmtUsage(p.value, p.unit)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <button
              onClick={() => {
                onClose()
                modals.openSettingsSection("usage")
              }}
              className="text-xs text-primary hover:underline cursor-pointer"
            >
              See shared pool usage →
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
