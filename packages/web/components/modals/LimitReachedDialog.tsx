"use client"

import { useCallback, useRef, useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQueryClient } from "@tanstack/react-query"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { Key, Star, Wallet } from "lucide-react"
import { AgentIcon } from "@/components/icons/agent-icons"
import { fmtBalance } from "@/lib/format"
import { GITHUB_STAR_CREDIT_USD } from "@/lib/bonus-credits"
import { queryKeys } from "@/lib/query/keys"

interface LimitReachedDialogProps {
  open: boolean
  onClose: () => void
  onContinueWithOpenCode: () => void
  onAddApiKey: () => void
  /** Takes the user to the Credits tab, where they can top up. */
  onBuyCredits: () => void
  /** Shared-pool provider the blocked run would have used (claude | gemini | opencode). */
  provider?: string
  /**
   * Purchased credits in USD — this is what actually gates a send (see
   * lib/db/usage-limit). Negative when the turn that emptied them overshot.
   */
  creditBalance?: number | null
  isMobile?: boolean
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
}

export function LimitReachedDialog({
  open,
  onClose,
  onContinueWithOpenCode,
  onAddApiKey,
  onBuyCredits,
  provider,
  creditBalance,
  isMobile = false,
}: LimitReachedDialogProps) {
  const providerLabel = PROVIDER_LABEL[provider ?? ""] ?? "shared model"
  const hasCredits = typeof creditBalance === "number" && creditBalance > 0
  // Always offer it, even when OpenCode was the pool that ran the user out: the
  // balance is pooled, and this routes to OpenCode's *free* models, which never
  // draw it down and so stay available at zero.
  const canSwitchToOpenCode = true
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const queryClient = useQueryClient()
  const [starRewarded, setStarRewarded] = useState(false)
  const [starred, setStarred] = useState(false)
  const [starPending, setStarPending] = useState(false)
  const [starStatusLoaded, setStarStatusLoaded] = useState(false)
  const [starError, setStarError] = useState<string | null>(null)

  useEffect(() => {
    setStarStatusLoaded(false)
    if (!open) return
    setStarError(null)
    let cancelled = false
    fetch("/api/user/star-reward")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check your GitHub star")
        return response.json() as Promise<{ rewarded: boolean; starred: boolean }>
      })
      .then((status) => {
        if (!cancelled) {
          setStarRewarded(status.rewarded)
          setStarred(status.starred)
          setStarError(null)
          setStarStatusLoaded(true)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setStarError(error instanceof Error ? error.message : "Could not check your GitHub star")
      })
    return () => { cancelled = true }
  }, [open])

  const handleStarReward = useCallback(async () => {
    if (!starStatusLoaded || starRewarded || starPending) return
    setStarPending(true)
    setStarError(null)
    try {
      const response = await fetch("/api/user/star-reward", { method: "POST" })
      const result = await response.json() as { rewarded?: boolean; error?: string }
      if (!response.ok) throw new Error(result.error || "Could not claim star credits")
      setStarRewarded(result.rewarded === true)
      setStarred(true)
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    } catch (error) {
      setStarError(error instanceof Error ? error.message : "Could not claim star credits")
    } finally {
      setStarPending(false)
    }
  }, [queryClient, starStatusLoaded, starRewarded, starPending])

  // Focus the primary button when modal opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        primaryButtonRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleContinueWithOpenCode = useCallback(() => {
    onContinueWithOpenCode()
    onClose()
  }, [onContinueWithOpenCode, onClose])

  const handleAddApiKey = useCallback(() => {
    onAddApiKey()
    onClose()
  }, [onAddApiKey, onClose])

  const handleBuyCredits = useCallback(() => {
    onBuyCredits()
    onClose()
  }, [onBuyCredits, onClose])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            MODAL_OVERLAY_CLASS,
            "transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            primaryButtonRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader title={hasCredits ? "Add Credits" : "Out of Credits"} />
          <div className="px-4 pt-3 pb-4 space-y-4">
            <div className="text-sm text-muted-foreground">
              {hasCredits ? (
                <>You have {fmtBalance(creditBalance)} in credits remaining.</>
              ) : typeof creditBalance === "number" && creditBalance < 0 ? (
                <>
                  Your last turn ran{" "}
                  <span className="font-medium text-foreground">
                    {fmtBalance(Math.abs(creditBalance))}
                  </span>{" "}
                  past your credits.
                </>
              ) : (
                "You're out of credits."
              )}{" "}
              Top up to continue, or star our repo on GitHub to get free credits — your
              balance is shared across Claude, OpenCode and Gemini.
            </div>

            <div className="space-y-2">
              {/* Primary option: purchase credits. Rewards can also refill the balance. */}
              <button
                ref={primaryButtonRef}
                onClick={handleBuyCredits}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors p-3 text-left cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Wallet className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Buy more credits
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {typeof creditBalance === "number" && creditBalance < 0
                      ? "Clear the deficit and pick up where you left off"
                      : "Top up your balance and pick up where you left off"}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleStarReward}
                disabled={!starStatusLoaded || starRewarded || starPending}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border border-border hover:bg-accent/50 transition-colors p-3 text-left cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-default"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                  <Star className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {!starStatusLoaded && !starError ? "Checking star reward…" : starRewarded ? "Star reward claimed" : starPending ? "Claiming star reward…" : starred ? "Claim star reward" : "Star our repo on GitHub"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {starRewarded ? "Thanks for starring Backgrounder" : "Credits are added immediately"}
                  </div>
                </div>
                <div className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded bg-amber-500/10">
                  ${GITHUB_STAR_CREDIT_USD.toFixed(2)} credit
                </div>
              </button>
              {starError && <p role="alert" className="text-xs text-destructive">{starError}</p>}

              {/* Option 2: OpenCode's free models, which never draw the balance. */}
              {canSwitchToOpenCode && (
                <button
                  onClick={handleContinueWithOpenCode}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-border hover:bg-accent/50 transition-colors p-3 text-left cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-ring"
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <AgentIcon agent="opencode" className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      Continue with OpenCode
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Free models - powered by open source
                    </div>
                  </div>
                  <div className="shrink-0 text-xs font-medium text-primary px-2 py-0.5 rounded bg-primary/10">
                    Free
                  </div>
                </button>
              )}

              {/* Option 3: Add API Key for the limited provider */}
              <button
                onClick={handleAddApiKey}
                className={cn(
                  "w-full flex items-center gap-3 rounded-lg border border-border hover:bg-accent/50 transition-colors p-3 text-left cursor-pointer",
                  "focus:outline-none focus:ring-2 focus:ring-ring"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Key className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    Add your {providerLabel} API key
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use your own {providerLabel} key for unlimited usage
                  </div>
                </div>
              </button>
            </div>

            {/* Dismiss */}
            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
