"use client"

import { Copy, RefreshCw, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScheduleFields } from "@/components/scheduled-jobs/ScheduleFields"
import { TRIGGER_TYPES, type IntervalUnit } from "@/components/scheduled-jobs/form-config"
import type { ScheduledJobFormErrors } from "@/lib/scheduled-jobs/form-validation"

// =============================================================================
// Types
// =============================================================================

interface TriggerOptionsFieldsProps {
  // Trigger type
  triggerType: "interval" | "incoming"
  setTriggerType: (v: "interval" | "incoming") => void
  clearFieldError: (field: "interval") => void

  // Schedule fields (interval trigger)
  isCustomInterval: boolean
  intervalMinutes: number
  customIntervalValue: number
  customIntervalUnit: IntervalUnit
  runAtDay: number
  runAtHourLocal: number
  effectiveIntervalMinutes: number
  timezoneName: string
  setIsCustomInterval: (v: boolean) => void
  setIntervalMinutes: (v: number) => void
  setCustomIntervalValue: (v: number) => void
  setCustomIntervalUnit: (v: IntervalUnit) => void
  setRunAtDay: (v: number) => void
  setRunAtHourLocal: (v: number) => void
  fieldErrors: ScheduledJobFormErrors

  // Webhook fields (incoming trigger)
  incomingToken: string | null
  incomingWebhookUrl: string
  copiedUrl: boolean
  rotating: boolean
  handleCopyUrl: () => void
  handleRotateToken: () => void

  // Options section
  isRepoLess: boolean
  showContinueOption: boolean
  showAutoPROption: boolean
  hasOptions: boolean
  continueFromLastRun: boolean
  setContinueFromLastRun: (v: boolean) => void
  autoPR: boolean
  setAutoPR: (v: boolean) => void
}

// =============================================================================
// Component
// =============================================================================

/**
 * The trigger-type selector + schedule/webhook fields + options toggles,
 * shared between the Scheduled Job create/edit form and (later) other
 * entry points that configure a scheduled job's trigger.
 */
export function TriggerOptionsFields({
  triggerType,
  setTriggerType,
  clearFieldError,
  isCustomInterval,
  intervalMinutes,
  customIntervalValue,
  customIntervalUnit,
  runAtDay,
  runAtHourLocal,
  effectiveIntervalMinutes,
  timezoneName,
  setIsCustomInterval,
  setIntervalMinutes,
  setCustomIntervalValue,
  setCustomIntervalUnit,
  setRunAtDay,
  setRunAtHourLocal,
  fieldErrors,
  incomingToken,
  incomingWebhookUrl,
  copiedUrl,
  rotating,
  handleCopyUrl,
  handleRotateToken,
  isRepoLess,
  showContinueOption,
  showAutoPROption,
  hasOptions,
  continueFromLastRun,
  setContinueFromLastRun,
  autoPR,
  setAutoPR,
}: TriggerOptionsFieldsProps) {
  return (
    <>
      {/* Trigger Type - Segmented Control. Always editable — PATCH
          handles the swap for both still-open drafts and existing
          jobs. */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Trigger</label>
        <div className="inline-flex rounded-md bg-muted p-0.5">
          {TRIGGER_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setTriggerType(t.value)
                if (t.value === "incoming") clearFieldError("interval")
              }}
              className={cn(
                "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                triggerType === t.value
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule - only for scheduled trigger */}
      {triggerType === "interval" && (
        <ScheduleFields
          isCustomInterval={isCustomInterval}
          intervalMinutes={intervalMinutes}
          customIntervalValue={customIntervalValue}
          customIntervalUnit={customIntervalUnit}
          runAtDay={runAtDay}
          runAtHourLocal={runAtHourLocal}
          effectiveIntervalMinutes={effectiveIntervalMinutes}
          timezoneName={timezoneName}
          setIsCustomInterval={setIsCustomInterval}
          setIntervalMinutes={setIntervalMinutes}
          setCustomIntervalValue={setCustomIntervalValue}
          setCustomIntervalUnit={setCustomIntervalUnit}
          setRunAtDay={setRunAtDay}
          setRunAtHourLocal={setRunAtHourLocal}
          error={fieldErrors.interval}
          onIntervalChange={() => clearFieldError("interval")}
        />
      )}

      {/* Incoming webhook URL panel — shown only for incoming triggers.
          The token is minted client-side as soon as the trigger is
          picked, so the URL (with copy + rotate) renders immediately,
          even before the job is saved. The fallback below only shows for
          the brief moment before the mint effect runs. */}
      {triggerType === "incoming" && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Webhook URL</label>

          {incomingToken ? (
            <>
              <div className="flex items-stretch gap-1">
                <input
                  type="text"
                  readOnly
                  value={incomingWebhookUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer"
                  title={copiedUrl ? "Copied" : "Copy URL"}
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={handleRotateToken}
                  disabled={rotating}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
                  title="Generate a new URL and invalidate the existing one"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", rotating && "animate-spin")} />
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Preparing your webhook URL…
            </p>
          )}
        </div>
      )}

      {/* Options Section — hidden when neither option applies (e.g. an
          incoming, repo-less job has neither the interval-only
          "continue" toggle nor the repo-only auto-PR toggle). */}
      {hasOptions && (
        <div>
          <label className="block text-sm font-medium mb-2">Options</label>
          <div className="space-y-2">
            {/* Continue from last run — same checkbox in both modes, but
                the backend interprets it differently: with a repo it
                reuses the prior branch; repo-less it prepends the prior
                run's final output as prompt context. */}
            {showContinueOption && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="continueFromLastRun"
                  checked={continueFromLastRun}
                  onChange={(e) => setContinueFromLastRun(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor="continueFromLastRun" className="text-sm">
                  {isRepoLess
                    ? "Include the previous run's output as context"
                    : "Include commits from the previous run"}
                </label>
              </div>
            )}

            {/* Auto-PR has no target in repo-less mode (no remote to push to). */}
            {showAutoPROption && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="autoPR"
                  checked={autoPR}
                  onChange={(e) => setAutoPR(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor="autoPR" className="text-sm">
                  Automatically create PR when there are new commits
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
