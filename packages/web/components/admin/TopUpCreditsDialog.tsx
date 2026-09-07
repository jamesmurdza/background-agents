"use client"

import { useState } from "react"
import { Wallet } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import { DialogLabel, DialogFooter, dialogIconClass } from "@/components/ui/dialog-parts"

interface TopUpCreditsDialogProps {
  open: boolean
  onClose: () => void
  userName: string
  /** Current balance, for display — not editable here. */
  balanceUsd: number
  onSubmit: (amountUsd: number, note?: string) => void
  isSubmitting?: boolean
  error?: string | null
}

/** Quick-pick amounts — the common cases, so most top-ups are one click. */
const QUICK_AMOUNTS = [1, 5, 20, 100]

/**
 * Admin dialog for manually moving a user's credit balance.
 *
 * A positive amount grants credits (a top-up); a negative one posts a
 * correction — both hit the same ledgered endpoint
 * (app/api/admin/users/[userId]/credits), so every movement here is
 * auditable and shows up in the user's own transaction history.
 */
export function TopUpCreditsDialog({
  open,
  onClose,
  userName,
  balanceUsd,
  onSubmit,
  isSubmitting = false,
  error,
}: TopUpCreditsDialogProps) {
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")

  const parsedAmount = Number(amount)
  const isValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount !== 0

  const handleClose = () => {
    setAmount("")
    setNote("")
    onClose()
  }

  const handleSubmit = () => {
    if (!isValid) return
    onSubmit(parsedAmount, note.trim() || undefined)
  }

  return (
    <BaseDialog
      open={open}
      onClose={handleClose}
      title={`Top up ${userName}`}
      icon={<Wallet className={dialogIconClass(false)} />}
    >
      <div className="space-y-4">
        <div>
          <DialogLabel>Current balance</DialogLabel>
          <p className="text-sm font-medium">${balanceUsd.toFixed(2)}</p>
        </div>

        <div>
          <DialogLabel>Amount (USD)</DialogLabel>
          <input
            autoFocus
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="5.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid) handleSubmit()
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => setAmount(String(quick))}
                className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                +${quick}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Negative amounts post a correction and reduce the balance.
          </p>
        </div>

        <div>
          <DialogLabel>Note (optional)</DialogLabel>
          <input
            type="text"
            placeholder="Reason for this adjustment"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter
          onCancel={handleClose}
          onAction={handleSubmit}
          actionLabel={
            isValid && parsedAmount < 0 ? "Deduct credits" : "Add credits"
          }
          disabled={!isValid}
          loading={isSubmitting}
        />
      </div>
    </BaseDialog>
  )
}
