"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { ModalHeader } from "@/components/ui/modal-header"
import { cn } from "@/lib/utils"
import { formatMetricValue } from "./charts/chartFormatters"
import type { UserModelUsage } from "@/lib/query/hooks"

interface BreakdownUser {
  userId: string
  name: string
  image: string | null
  models: UserModelUsage[]
}

interface UserModelBreakdownModalProps {
  /** User to show the breakdown for; null when the modal is closed. */
  user: BreakdownUser | null
  onClose: () => void
  showCost?: boolean
}

/**
 * Per-model breakdown for one user, in a modal.
 *
 * Used to be an inline expand/collapse row in the Usage by user table — moved
 * to a modal so a row click doesn't fight with the row's new checkbox and so
 * the table doesn't reflow every time one is opened.
 */
export function UserModelBreakdownModal({
  user,
  onClose,
  showCost = true,
}: UserModelBreakdownModalProps) {
  const open = user !== null

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-hidden flex flex-col",
            "bg-popover border border-border rounded-xl shadow-xl"
          )}
        >
          {user && (
            <>
              <ModalHeader
                title={
                  <span className="flex items-center gap-2">
                    {user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.image} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                    ) : (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                        {user.name[0]?.toUpperCase() || "?"}
                      </span>
                    )}
                    {user.name}
                  </span>
                }
              />
              <div className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
                {user.models.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    No usage on the selected provider(s) in this range.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-medium">Model</th>
                        <th className="py-1.5 text-left font-medium">Pool</th>
                        <th className="py-1.5 text-right font-medium">Tokens</th>
                        {showCost && (
                          <th className="py-1.5 text-right font-medium">List value</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {user.models.map((m, i) => (
                        <tr key={`${m.model}-${m.pool}-${i}`} className="border-t border-border/60">
                          <td className="py-1.5 pr-2 font-mono text-xs">{m.model}</td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                m.pool === "shared"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {m.pool === "shared" ? "our pool" : "own key"}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatMetricValue("tokens", m.tokens)}
                          </td>
                          {showCost && (
                            <td className="py-1.5 text-right tabular-nums">
                              {formatMetricValue("cost", m.cost)}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
