"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

interface SandboxResizeModalProps {
  open: boolean
  onClose: () => void
  /** Sandbox to resize. Null (no active chat/sandbox) disables the submit button, unless `isDraft`. */
  sandboxId: string | null
  isMobile?: boolean
  /**
   * True for a draft chat (no sandbox yet). Instead of resizing a live
   * sandbox, the chosen RAM/disk are staged via `onSaveDraftResources` and
   * applied once when the draft's sandbox actually gets created.
   */
  isDraft?: boolean
  /** Resources already staged on the draft, if any — seeds the sliders instead of the snapshot defaults. */
  pendingResources?: { memory?: number; disk?: number }
  /** Stages the chosen resources on the draft. Only called when `isDraft`. */
  onSaveDraftResources?: (resources: { memory: number; disk: number }) => void
}

const MIN_GB = 0
/** Hard ceilings — must match MAX_MEMORY_GB/MAX_DISK_GB in the API route. */
const MAX_MEMORY_GB = 10
const MAX_DISK_GB = 25
const GIB = 1024 ** 3

interface UsageStat {
  usedGb: number
  totalGb: number
}

function clamp(value: number, max: number, floor: number = MIN_GB): number {
  return Math.min(Math.max(value, floor), max)
}

function bytesToUsage(usedBytes: number, totalBytes: number): UsageStat {
  return {
    usedGb: Math.round((usedBytes / GIB) * 10) / 10,
    totalGb: Math.round((totalBytes / GIB) * 10) / 10,
  }
}

function sliderClasses() {
  return cn(
    "relative w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer accent-primary",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
    "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
    "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background",
    "[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-grab",
    "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
    "[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  )
}

/**
 * A MIN_GB-max GB slider with the segment below `floor` visually greyed out
 * and unreachable, rather than shrinking the slider's own min — the full
 * range stays visible so "GB you can't go below" and "GB that don't exist"
 * read differently.
 */
function ResourceSlider({
  id,
  label,
  value,
  max,
  floor,
  usage,
  showUsage = true,
  loading,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: number
  /** Highest value the thumb may reach (e.g. 10 for RAM, 25 for disk). */
  max: number
  /** Lowest value the thumb may land on; null while still loading. */
  floor: number | null
  /** Live used/total from inside the sandbox; null while loading or stopped. */
  usage: UsageStat | null
  /** Whether this resource tracks used/total at all (disk does; RAM doesn't). */
  showUsage?: boolean
  /** Still fetching the initial allocation/usage. */
  loading: boolean
  disabled: boolean
  onChange: (value: number) => void
}) {
  const effectiveFloor = floor ?? MIN_GB
  const scale = max - MIN_GB
  // Position on the slider's own MIN_GB-max scale, so the usage bar below
  // lines up with it instead of running on its own 0-100% axis.
  const pct = (value: number) => Math.min(100, Math.max(0, ((value - MIN_GB) / scale) * 100))
  // `disabledPct` IS the allocation boundary — reused below for the usage
  // bar's taken/available split instead of recomputing it from usage.totalGb,
  // so the two bars can't disagree about where the current allocation ends.
  const disabledPct = pct(effectiveFloor)
  const takenPct = usage ? pct(usage.usedGb) : null

  // While the real allocation/usage is in flight, show placeholder bars
  // rather than the slider at some value that might not be true yet — the
  // alternative (defaulting to e.g. 2 GB) would flash a wrong number before
  // snapping to the real one once the fetch resolves.
  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="h-3.5 w-10 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted animate-pulse" />
        <div className="mt-1 flex justify-between">
          <div className="h-2.5 w-8 rounded bg-muted animate-pulse" />
          <div className="h-2.5 w-8 rounded bg-muted animate-pulse" />
        </div>
        {showUsage && (
          <>
            <div className="mt-2 h-1 w-full rounded-full bg-muted animate-pulse" />
            <div className="mt-1 h-2.5 w-32 rounded bg-muted animate-pulse" />
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <span className="text-sm font-medium tabular-nums">{value} GB</span>
      </div>
      <div className="relative flex items-center">
        <input
          id={id}
          type="range"
          min={MIN_GB}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), max, effectiveFloor))}
          disabled={disabled}
          aria-label={`${label} in GB`}
          aria-valuemin={effectiveFloor}
          className={sliderClasses()}
        />
        {/* Greys out the unreachable segment below the current allocation —
            purely visual, pointer-events-none so dragging still goes through
            to the input underneath; onChange clamps anything landing here. */}
        {disabledPct > 0 && (
          <div
            className="absolute left-0 h-1.5 rounded-l-full bg-foreground/15 pointer-events-none"
            style={{ width: `${disabledPct}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{MIN_GB} GB</span>
        <span>{max} GB</span>
      </div>

      {/* Live used/available, read from inside the sandbox — drawn on the
          same MIN_GB-max scale as the slider above (blue stops where usage
          ends, white runs to `disabledPct` — the same allocation boundary
          the slider greys out — and the rest is unallocated headroom).
          Not tracked for every resource (e.g. RAM), so this block is opt-in. */}
      {showUsage && (
        usage && takenPct != null ? (
          <div className="mt-2">
            <div className="h-1.5 flex rounded-full overflow-hidden border border-border">
              <div className="bg-blue-500" style={{ width: `${takenPct}%` }} />
              <div className="bg-white dark:bg-neutral-200" style={{ width: `${disabledPct - takenPct}%` }} />
              <div className="bg-muted" style={{ width: `${100 - disabledPct}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {usage.usedGb} GB used of {usage.totalGb} GB allocated
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {loading ? "Loading usage…" : "Usage unavailable (sandbox not running)"}
          </p>
        )
      )}
    </div>
  )
}

/**
 * Admin-only modal to set a sandbox's RAM (up to MAX_MEMORY_GB) and disk (up
 * to MAX_DISK_GB) allocation. Opened from the chat title menu and the
 * Cmd/Ctrl+K command palette (both gated on `session.user.isAdmin` by the
 * caller — this component doesn't re-check admin-ness, the API route does
 * via `requireAdmin`).
 *
 * For a real chat (`isDraft` false), this resizes the live sandbox via
 * `/api/sandbox/resize` — increase only, per the Daytona API. For a draft
 * chat (no sandbox yet), it instead stages the chosen values via
 * `onSaveDraftResources`, applied once when the draft's sandbox actually
 * gets created — see `pendingResources` in lib/storage.ts.
 */
export function SandboxResizeModal({
  open,
  onClose,
  sandboxId,
  isMobile = false,
  isDraft = false,
  pendingResources,
  onSaveDraftResources,
}: SandboxResizeModalProps) {
  const [memory, setMemory] = useState(0)
  const [disk, setDisk] = useState(0)
  // For a real sandbox, this is the floor the sliders won't go below —
  // Daytona only supports growing memory/disk, never shrinking (hot resize
  // can only increase CPU/memory, and disk resize throws on any decrease).
  // For a draft (nothing provisioned yet, so no such limit), it's only used
  // as the baseline "has the user changed anything from the seeded default"
  // comparison for `hasChanges` below — the slider itself gets `floor={null}`
  // in that case so the full range stays selectable.
  // Null until we've loaded the real values (sandbox allocation, or — for a
  // draft — the snapshot's defaults).
  const [memoryFloor, setMemoryFloor] = useState<number | null>(null)
  const [diskFloor, setDiskFloor] = useState<number | null>(null)
  // Live disk used/total, read from inside the sandbox. Null when loading,
  // or when the sandbox is stopped (nothing to query usage from). RAM has no
  // equivalent viewer — see the "remove the RAM available viewer" ask.
  const [diskUsage, setDiskUsage] = useState<UsageStat | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Applies a /api/sandbox/resize response (GET or POST) to the sliders:
  // floor + value from the allocation, used/total from the usage block. Used
  // both for the initial load and to refresh after a successful resize,
  // since a resize changes both the allocation and (for disk) what "used"
  // looks like against the new total.
  const applyStatus = (data: {
    memory?: number
    disk?: number
    usage?: {
      diskUsedBytes?: number
      diskTotalBytes?: number
    } | null
  }) => {
    if (typeof data.memory === "number") {
      // Ceil the floor so a fractional current value (e.g. 2.3 GiB) never
      // leaves the slider sitting below what's actually allocated.
      const floor = clamp(Math.ceil(data.memory), MAX_MEMORY_GB)
      setMemoryFloor(floor)
      setMemory(clamp(Math.round(data.memory), MAX_MEMORY_GB, floor))
    }
    if (typeof data.disk === "number") {
      const floor = clamp(Math.ceil(data.disk), MAX_DISK_GB)
      setDiskFloor(floor)
      setDisk(clamp(Math.round(data.disk), MAX_DISK_GB, floor))
    }
    const usage = data.usage
    setDiskUsage(
      usage && typeof usage.diskUsedBytes === "number" && typeof usage.diskTotalBytes === "number"
        ? bytesToUsage(usage.diskUsedBytes, usage.diskTotalBytes)
        : null
    )
  }

  // On open, load the real values rather than snapping the sliders to a
  // hardcoded placeholder:
  // - Real sandbox: what's actually provisioned right now — otherwise a
  //   resize that already landed would look reverted the next time this
  //   opens. Also sets the floor the sliders can't be dragged below, since
  //   the Daytona API rejects any decrease.
  // - Draft (no sandbox yet): whatever was already staged on the draft
  //   (`pendingResources`), or if nothing's staged, the snapshot's own
  //   defaults (`SNAPSHOT_RESOURCES`, fetched from the same API route so
  //   there's one source of truth for "what does a new sandbox start with"
  //   instead of a second hardcoded copy here).
  useEffect(() => {
    if (!open) return
    setError(null)
    setSuccess(false)
    setSubmitting(false)

    if (!sandboxId && !isDraft) {
      setMemoryFloor(null)
      setDiskFloor(null)
      setDiskUsage(null)
      return
    }

    if (isDraft && pendingResources?.memory != null && pendingResources?.disk != null) {
      // Already staged — no need to ask the server what the snapshot
      // defaults are, this fully overrides them.
      setMemory(pendingResources.memory)
      setDisk(pendingResources.disk)
      setMemoryFloor(pendingResources.memory)
      setDiskFloor(pendingResources.disk)
      setDiskUsage(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const url = sandboxId ? `/api/sandbox/resize?sandboxId=${encodeURIComponent(sandboxId)}` : "/api/sandbox/resize"
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        // A draft with one of the two already staged (e.g. memory set, disk
        // not) still needs the other from the snapshot defaults.
        if (isDraft) {
          applyStatus({
            memory: pendingResources?.memory ?? data.memory,
            disk: pendingResources?.disk ?? data.disk,
          })
        } else {
          applyStatus(data)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error("[SandboxResizeModal] Failed to load current resources:", e)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sandboxId, isDraft, pendingResources?.memory, pendingResources?.disk])

  // The floor doubles as the baseline to compare against: for a real
  // sandbox it's the loaded allocation (applyStatus clamps the initial
  // slider value up to it); for a draft it's whatever was staged/defaulted
  // above. Either way, comparing against it is exactly "has the user moved
  // a slider away from where it started" — no separate "initial value"
  // state to keep in sync.
  const hasChanges = memoryFloor != null && diskFloor != null && (memory !== memoryFloor || disk !== diskFloor)

  const submit = async () => {
    if (submitting) return
    if (isDraft) {
      setSubmitting(true)
      setError(null)
      try {
        onSaveDraftResources?.({ memory, disk })
        setMemoryFloor(memory)
        setDiskFloor(disk)
        setSuccess(true)
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (!sandboxId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/sandbox/resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId, memory, disk }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not resize sandbox")
      }
      // The resize response doesn't include fresh usage (the sandbox was
      // just stopped/resized/restarted, so usage right now is a race either
      // way) — re-fetch so the bars reflect the new allocation cleanly.
      setSuccess(true)
      const refreshed = await fetch(`/api/sandbox/resize?sandboxId=${encodeURIComponent(sandboxId)}`).then((r) =>
        r.json()
      )
      applyStatus(refreshed)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resize sandbox")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px]" />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl border border-border"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                Sandbox resources
              </>
            }
          />

          <div className="px-4 pt-2 pb-4 space-y-5">
            <p className="text-xs text-muted-foreground">
              {isDraft
                ? "Admin only. Sets the RAM/disk this chat's sandbox is created with."
                : "Admin only. Resources can only be increased, not decreased. Increasing disk requires briefly stopping the sandbox."}
            </p>

            <ResourceSlider
              id="resize-memory"
              label="RAM"
              value={memory}
              max={MAX_MEMORY_GB}
              floor={isDraft ? null : memoryFloor}
              usage={null}
              showUsage={false}
              loading={loading}
              disabled={submitting || loading}
              onChange={setMemory}
            />

            <ResourceSlider
              id="resize-disk"
              label="Disk space"
              value={disk}
              max={MAX_DISK_GB}
              floor={isDraft ? null : diskFloor}
              usage={diskUsage}
              loading={loading}
              disabled={submitting || loading}
              onChange={setDisk}
            />

            {error && <p className="text-xs text-destructive">{error}</p>}
            {success && !error && (
              <p className="text-xs text-green-600 dark:text-green-500">
                {isDraft ? "Saved — applied when the sandbox is created." : "Resize complete."}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={(!sandboxId && !isDraft) || submitting || loading || !hasChanges}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-ring/60",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? isDraft ? "Saving…" : "Resizing…"
                : !sandboxId && !isDraft
                  ? "No sandbox"
                  : !hasChanges
                    ? "No changes"
                    : "Apply"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
