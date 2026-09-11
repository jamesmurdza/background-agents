"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMetricValue } from "./charts/chartFormatters"
import { UserModelBreakdownModal } from "./UserModelBreakdownModal"
import type { TopupUser, UserBalance, UserUsage } from "@/lib/query/hooks"

interface UsageByUserTableProps {
  users: UserUsage[]
  /** Topped-up/spent totals from the credit ledger, keyed by userId. Merged
   * into the usage rows so the table reads as one roster rather than three —
   * see the module doc below. */
  ledger: TopupUser[]
  /** Current credit balance per user — not range-scoped, see the topups route. */
  balances: UserBalance[]
  /**
   * Whether a dollar figure says anything useful here. True for every shared-
   * pool provider today (Claude, OpenCode, Gemini all have a real pricing
   * multiplier — see lib/server/credits) — kept as a prop rather than hardcoded
   * so a future provider with no priced usage can still opt out of the List
   * value column without a code change here.
   */
  showCost?: boolean
  isLoading?: boolean
  /**
   * Which users are checked, for the stacked-area-by-user chart above this
   * table. `null` means "everyone" — the default, before anyone has touched a
   * checkbox — so a newly-appeared user (a wider range, a changed provider
   * filter) is included without the caller having to reconcile a stale set.
   */
  selectedUserIds: Set<string> | null
  onSelectionChange: (next: Set<string> | null) => void
}

/** A usage row, widened with the ledger's topped-up/spent/balance totals. */
interface MergedUser extends UserUsage {
  toppedUpUsd: number
  spentUsd: number
  balanceUsd: number
}

/**
 * Merge per-provider usage rows with the (provider-agnostic) credit ledger.
 *
 * A left-heavy union: every usage row keeps its place (already ranked by the
 * selected metric), and any user who only shows up in the ledger — topped up
 * or was charged, but has no usage on the currently selected provider(s) — is
 * appended after, ranked by how much they've topped up. Nobody with money on
 * either side of the ledger silently drops off the table.
 */
function mergeUsers(users: UserUsage[], ledger: TopupUser[], balances: UserBalance[]): MergedUser[] {
  const ledgerById = new Map(ledger.map((l) => [l.userId, l]))
  const balanceById = new Map(balances.map((b) => [b.userId, b.balanceUsd]))
  const seen = new Set<string>()

  const withLedger = users.map((u) => {
    seen.add(u.userId)
    const l = ledgerById.get(u.userId)
    return {
      ...u,
      toppedUpUsd: l?.toppedUpUsd ?? 0,
      spentUsd: l?.spentUsd ?? 0,
      balanceUsd: balanceById.get(u.userId) ?? 0,
    }
  })

  const ledgerOnly = ledger
    .filter((l) => !seen.has(l.userId))
    .map((l) => ({
      userId: l.userId,
      name: l.name,
      image: l.image,
      tokens: 0,
      cost: 0,
      sharedTokens: 0,
      sharedCost: 0,
      ownTokens: 0,
      ownCost: 0,
      models: [],
      toppedUpUsd: l.toppedUpUsd,
      spentUsd: l.spentUsd,
      balanceUsd: balanceById.get(l.userId) ?? 0,
    }))
    .sort((a, b) => b.toppedUpUsd - a.toppedUpUsd)

  return [...withLedger, ...ledgerOnly]
}

/** Share of a user's tokens that ran on our credentials, 0–100. Tokens rather
 * than list value: it's the one measure every provider has, pricing changes
 * aside. */
function sharedShare(user: UserUsage): number {
  if (user.tokens <= 0) return 0
  return (user.sharedTokens / user.tokens) * 100
}

type SortField = "name" | "toppedUp" | "balance" | "spent" | "tokens" | "cost" | "pool" | "models"
type SortOrder = "asc" | "desc"

/** The value each column actually sorts on — mirrors what's rendered in that cell. */
function sortValue(user: MergedUser, field: SortField): string | number {
  switch (field) {
    case "name":
      return user.name.toLowerCase()
    case "toppedUp":
      return user.toppedUpUsd
    case "balance":
      return user.balanceUsd
    case "spent":
      return user.spentUsd
    case "tokens":
      return user.tokens
    case "cost":
      return user.cost
    case "pool":
      return sharedShare(user)
    case "models":
      return user.models.length
  }
}

function sortUsers(users: MergedUser[], field: SortField, order: SortOrder): MergedUser[] {
  const sign = order === "asc" ? 1 : -1
  return [...users].sort((a, b) => {
    const av = sortValue(a, field)
    const bv = sortValue(b, field)
    if (typeof av === "string" || typeof bv === "string") {
      return sign * String(av).localeCompare(String(bv))
    }
    return sign * (av - bv)
  })
}

function SortHeader({
  label,
  field,
  currentField,
  currentOrder,
  onSort,
  align = "right",
  className,
}: {
  label: string
  field: SortField
  currentField: SortField
  currentOrder: SortOrder
  onSort: (field: SortField) => void
  align?: "left" | "right"
  className?: string
}) {
  const isActive = currentField === field
  return (
    <th
      className={cn(
        "px-2 py-2 font-medium sm:px-3",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      <button
        onClick={() => onSort(field)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse"
        )}
      >
        {label}
        {isActive ? (
          currentOrder === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

/** A checkbox that can also render its native `indeterminate` visual state,
 * which has no React prop and must be set on the DOM node directly. */
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  onClick,
  "aria-label": ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  onClick?: (e: React.MouseEvent) => void
  "aria-label"?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={onClick}
      aria-label={ariaLabel}
      className="h-4 w-4 rounded border-border accent-primary"
    />
  )
}

/**
 * Per-user usage, with a per-model breakdown available in a modal.
 *
 * A table rather than a chart on purpose: "who used what, on which model, from
 * which pool" is four dimensions, and a table reads them at a glance where a
 * chart would need encoding tricks. Every column header sorts. The leftmost
 * checkbox column drives the stacked-area-by-user chart above this table —
 * this table IS the chart's series picker, not a separate control.
 */
export function UsageByUserTable({
  users,
  ledger,
  balances,
  showCost = true,
  isLoading,
  selectedUserIds,
  onSelectionChange,
}: UsageByUserTableProps) {
  const [modalUser, setModalUser] = useState<MergedUser | null>(null)
  // Tokens rather than cost: it's the one column that's always present, even
  // for a future provider with no priced usage — so the default sort never
  // depends on showCost.
  const [sortField, setSortField] = useState<SortField>("tokens")
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc")

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortOrder("desc")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-muted animate-pulse" />
            <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const merged = mergeUsers(users, ledger, balances)

  if (merged.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-center text-muted-foreground text-sm">
        No usage or top-ups recorded in this range
      </div>
    )
  }

  const sorted = sortUsers(merged, sortField, sortOrder)

  const isSelected = (userId: string) => selectedUserIds === null || selectedUserIds.has(userId)
  const allSelected = selectedUserIds === null || sorted.every((u) => selectedUserIds.has(u.userId))
  const noneSelected = selectedUserIds !== null && selectedUserIds.size === 0

  const toggleUser = (userId: string) => {
    // Resolve the "null = everyone" sentinel to a concrete set the moment a
    // single row is touched, then flip just that one id.
    const next = new Set(selectedUserIds ?? sorted.map((u) => u.userId))
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onSelectionChange(next)
  }

  const toggleAll = () => {
    onSelectionChange(allSelected ? new Set() : null)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs">
            <th className="w-8 px-2 py-2 sm:px-3">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && !noneSelected}
                onChange={toggleAll}
                aria-label={allSelected ? "Deselect all users" : "Select all users"}
              />
            </th>
            <SortHeader
              label="User"
              field="name"
              align="left"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
            />
            <SortHeader
              label="Topped up"
              field="toppedUp"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
            />
            <SortHeader
              label="Balance"
              field="balance"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
            />
            <SortHeader
              label="Spent"
              field="spent"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
            />
            <SortHeader
              label="Tokens"
              field="tokens"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
            />
            {showCost && (
              <SortHeader
                label="List value"
                field="cost"
                currentField={sortField}
                currentOrder={sortOrder}
                onSort={handleSort}
              />
            )}
            <SortHeader
              label="On our pool"
              field="pool"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
              className="hidden sm:table-cell"
            />
            <SortHeader
              label="Models"
              field="models"
              currentField={sortField}
              currentOrder={sortOrder}
              onSort={handleSort}
              className="hidden md:table-cell"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((user) => {
            const share = sharedShare(user)
            return (
              <tr
                key={user.userId}
                onClick={() => setModalUser(user)}
                className="cursor-pointer border-b hover:bg-muted/50"
              >
                <td className="px-2 py-2 sm:px-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isSelected(user.userId)}
                    onChange={() => toggleUser(user.userId)}
                    aria-label={`${isSelected(user.userId) ? "Deselect" : "Select"} ${user.name}`}
                  />
                </td>
                <td className="px-2 py-2 sm:px-3">
                  <div className="flex items-center gap-2">
                    {user.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.image} alt="" className="h-6 w-6 shrink-0 rounded-full" />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {user.name[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <span className="truncate font-medium">{user.name}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                  {formatMetricValue("cost", user.toppedUpUsd)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums sm:px-3",
                    user.balanceUsd < 0 && "text-destructive"
                  )}
                >
                  {formatMetricValue("cost", user.balanceUsd)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                  {formatMetricValue("cost", user.spentUsd)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                  {formatMetricValue("tokens", user.tokens)}
                </td>
                {showCost && (
                  <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                    {formatMetricValue("cost", user.cost)}
                  </td>
                )}
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3">
                  <span className={cn(share > 0 ? "text-foreground" : "text-muted-foreground")}>
                    {share.toFixed(0)}%
                  </span>
                </td>
                <td className="hidden px-2 py-2 text-right tabular-nums text-muted-foreground md:table-cell md:px-3">
                  {user.models.length}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Check a user to include them in the chart above; click a row for its
        per-model breakdown. &ldquo;Topped up&rdquo;, &ldquo;Balance&rdquo;, and
        &ldquo;Spent&rdquo; are real dollars from the credit ledger — purchases,
        current balance, and usage debits — independent of which provider(s) are
        filtered below; a negative balance means the account overshot. &ldquo;On
        our pool&rdquo; is the share of that user&apos;s tokens, across the
        filtered providers, that ran on our credentials rather than their own
        key. List value is API-equivalent cost, not necessarily a bill — real
        for OpenCode&apos;s and Gemini&apos;s metered keys, notional for
        Claude&apos;s flat subscription.
      </p>
      <UserModelBreakdownModal
        user={modalUser}
        onClose={() => setModalUser(null)}
        showCost={showCost}
      />
    </div>
  )
}
