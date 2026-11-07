"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Gift, Search, X, CheckCircle2, AlertCircle, Plus, Users } from "lucide-react"
import {
  useAdminUsersQuery,
  useBonusCreditsQuery,
  useGrantBonusCreditsMutation,
  type GrantBonusCreditsResult,
} from "@/lib/query/hooks"
import {
  BONUS_CREDIT_REASONS,
  MAX_BONUS_CREDIT_USD,
  bonusReasonLabel,
  type BonusCreditReason,
  type BonusCreditRequest,
} from "@/lib/bonus-credits"
import { fmtBalance } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"

interface PickedUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

function displayName(u: { name: string | null; email: string | null; id: string }) {
  return u.name || u.email || u.id
}

/**
 * Admin panel for handing out bonus credits — rewards for starring the repo,
 * opening a PR or filing an issue — to one user, a hand-picked set, or every
 * account. Separate from the automatic daily credits; see lib/bonus-credits.
 */
export function BonusCredits() {
  const [target, setTarget] = useState<"users" | "all">("users")
  const [picked, setPicked] = useState<PickedUser[]>([])
  const [search, setSearch] = useState("")
  const [amount, setAmount] = useState("5")
  const [reason, setReason] = useState<BonusCreditReason>("github_star")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<GrantBonusCreditsResult | null>(null)
  const [pendingGrant, setPendingGrant] = useState<{
    request: BonusCreditRequest
    who: string
  } | null>(null)

  const searchQuery = useAdminUsersQuery({ page: 1, limit: 8, search: search.trim() || undefined })
  // Unfiltered count, for the "all users" confirmation.
  const totalQuery = useAdminUsersQuery({ page: 1, limit: 1 })
  const totalUsers = totalQuery.data?.pagination.total ?? null
  const historyQuery = useBonusCreditsQuery()
  const mutation = useGrantBonusCreditsMutation()

  const pickedIds = new Set(picked.map((u) => u.id))
  const amountUsd = Number(amount)
  const recipientCount = target === "all" ? totalUsers : picked.length

  function addUser(u: PickedUser) {
    if (pickedIds.has(u.id)) return
    setPicked((p) => [...p, u])
  }

  function submit() {
    setFormError(null)
    setResult(null)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      setFormError("Amount must be a positive number")
      return
    }
    if (amountUsd > MAX_BONUS_CREDIT_USD) {
      setFormError(`Amount must be at most $${MAX_BONUS_CREDIT_USD}`)
      return
    }
    if (target === "users" && picked.length === 0) {
      setFormError("Pick at least one user")
      return
    }
    if (reason === "other" && !note.trim()) {
      setFormError('Add a note when the reason is "Other"')
      return
    }
    const who =
      target === "all"
        ? `ALL${totalUsers !== null ? ` ${totalUsers}` : ""} users`
        : `${picked.length} user${picked.length === 1 ? "" : "s"}`
    setPendingGrant({
      who,
      request: {
        target,
        userIds: target === "users" ? picked.map((u) => u.id) : [],
        amountUsd,
        reason,
        note: note.trim() || null,
        reference: reference.trim() || null,
      },
    })
  }

  function confirmGrant() {
    if (!pendingGrant || mutation.isPending) return
    mutation.mutate(
      pendingGrant.request,
      {
        onSuccess: (r) => {
          setResult(r)
          setPicked([])
          setReference("")
          setNote("")
        },
        onError: (e) => setFormError(e.message),
      }
    )
  }

  const searchResults = (searchQuery.data?.users ?? []).filter((u) => !pickedIds.has(u.id))
  const grants = historyQuery.data?.grants ?? []

  return (
    <section className="space-y-6">
      <ConfirmDialog
        open={pendingGrant !== null}
        onClose={() => setPendingGrant(null)}
        onConfirm={confirmGrant}
        title="Grant bonus credits?"
        description={pendingGrant &&
          `Grant ${fmtBalance(pendingGrant.request.amountUsd)} to ${pendingGrant.who} for "${bonusReasonLabel(pendingGrant.request.reason)}"?`
        }
        confirmLabel="Grant credits"
      />
      <div>
        <h2 className="text-lg font-semibold md:text-xl">Bonus credits</h2>
        <p className="text-xs text-muted-foreground">
          Reward users for starring the repo, opening a PR or filing an issue. Added to their
          balance on top of the daily credits.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
            <Gift className="h-4 w-4 text-emerald-500" />
          </div>
          <h3 className="font-medium">Grant credits</h3>
        </div>

        {/* Recipients */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Recipients</label>
          <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
            {(
              [
                { key: "users", label: "Selected users" },
                { key: "all", label: "All users" },
              ] as const
            ).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setTarget(o.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-all sm:px-4 sm:text-sm",
                  target === o.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {target === "all" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              Every account{totalUsers !== null && ` (${totalUsers} users)`} will be credited.
            </p>
          ) : (
            <div className="space-y-2">
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((u) => (
                    <span
                      key={u.id}
                      className="flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-1 pr-2 text-xs"
                    >
                      {u.image ? (
                        <img src={u.image} alt="" className="h-4 w-4 rounded-full" />
                      ) : (
                        <span className="h-4 w-4 rounded-full bg-muted" />
                      )}
                      {displayName(u)}
                      <button
                        type="button"
                        onClick={() => setPicked((p) => p.filter((x) => x.id !== u.id))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${displayName(u)}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPicked([])}
                    className="text-xs text-muted-foreground hover:text-foreground px-1"
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email or GitHub id…"
                  className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm"
                />
              </div>
              <div className="max-w-md rounded-md border divide-y">
                {searchQuery.isLoading ? (
                  <div className="p-3 text-xs text-muted-foreground">Loading…</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">No matching users</div>
                ) : (
                  searchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addUser(u)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      {u.image ? (
                        <img src={u.image} alt="" className="h-5 w-5 rounded-full" />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-muted" />
                      )}
                      <span className="flex-1 min-w-0 truncate">
                        {u.name || "—"}
                        {u.email && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{u.email}</span>
                        )}
                      </span>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Amount + reason */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="bonus-amount">
              Amount per user (USD)
            </label>
            <input
              id="bonus-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="bonus-reason">
              Reason
            </label>
            <select
              id="bonus-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as BonusCreditReason)}
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              {BONUS_CREDIT_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {reason !== "github_star" && reason !== "other" && (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium" htmlFor="bonus-reference">
                Link or number <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="bonus-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={reason === "pull_request" ? "e.g. #123 or PR URL" : "e.g. #45 or issue URL"}
                className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This prevents the same user from being rewarded twice for the same{" "}
                {reason === "pull_request" ? "PR" : "issue"}.
              </p>
            </div>
          )}
          {reason === "github_star" && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Each user can only receive the star reward once, and repeat grants are skipped.
            </p>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium" htmlFor="bonus-note">
              Note{" "}
              <span className="font-normal text-muted-foreground">
                {reason === "other" ? "(required)" : "(optional)"}
              </span>
            </label>
            <input
              id="bonus-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth remembering about this grant"
              className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending
              ? "Granting…"
              : `Grant${
                  Number.isFinite(amountUsd) && amountUsd > 0 ? ` ${fmtBalance(amountUsd)}` : ""
                }${recipientCount ? ` to ${recipientCount} user${recipientCount === 1 ? "" : "s"}` : ""}`}
          </button>
          {formError && (
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              {formError}
            </span>
          )}
          {result && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              Granted {fmtBalance(result.totalUsd)} to {result.granted} user
              {result.granted === 1 ? "" : "s"}
              {result.skipped > 0 && ` · ${result.skipped} already rewarded, skipped`}
              {result.failed > 0 && ` · ${result.failed} failed`}
              {result.notFound.length > 0 && ` · ${result.notFound.length} not found`}
            </span>
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl border bg-card p-4 md:p-6 shadow-sm">
        <h3 className="mb-4 font-medium">Recent bonus grants</h3>
        {historyQuery.isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted/50" />
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bonus credits granted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Details</th>
                  <th className="py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="py-2 pr-3">{displayName(g.user)}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtBalance(g.amountUsd)}</td>
                    <td className="py-2 pr-3">
                      {bonusReasonLabel(g.reason)}
                      {g.target === "all" && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          all users
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {[g.reference, g.note].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
