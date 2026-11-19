"use client"

import { useState, useEffect, useMemo } from "react"
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard"
import {
  UNIT_MINUTES,
  inferIntervalMode,
  getTimezoneName,
  type IntervalUnit,
} from "@/components/scheduled-jobs/form-config"
import type { ScheduledJobFormErrors, ScheduledJobFormField } from "@/lib/scheduled-jobs/form-validation"

interface UseTriggerOptionsStateArgs {
  /** Whether a repo is currently selected in the composer — drives the
   * repo-only (auto-PR) vs interval-only (continue) toggle visibility. */
  isRepoLess: boolean
  /** Reset the trigger/options state to defaults each time this flips to true. */
  open: boolean
}

/**
 * The trigger/schedule/options slice of useScheduledJobForm, extracted so the
 * composer's "schedule this prompt" popover can reuse TriggerOptionsFields
 * without pulling in the rest of the full job form (name/prompt/repo/agent).
 */
export function useTriggerOptionsState({ isRepoLess, open }: UseTriggerOptionsStateArgs) {
  // Create-mode default mirrors useScheduledJobForm's own default for new
  // jobs: inferIntervalMode(1440) -> daily.
  const initialIntervalMode = inferIntervalMode(1440)
  const [triggerType, setTriggerType] = useState<"interval" | "incoming">("interval")
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMode.intervalMinutes)
  const [isCustomInterval, setIsCustomInterval] = useState(initialIntervalMode.isCustom)
  const [customIntervalValue, setCustomIntervalValue] = useState(initialIntervalMode.customValue)
  const [customIntervalUnit, setCustomIntervalUnit] = useState<IntervalUnit>(initialIntervalMode.customUnit)
  const [runAtHourLocal, setRunAtHourLocal] = useState(9)
  const [runAtDay, setRunAtDay] = useState(1)
  const [autoPR, setAutoPR] = useState(true)
  const [continueFromLastRun, setContinueFromLastRun] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<ScheduledJobFormErrors>({})

  const [incomingToken, setIncomingToken] = useState<string | null>(null)
  const { copied: copiedUrl, copy: copyUrl } = useCopyToClipboard(1500)
  const [rotating] = useState(false)

  const timezoneName = useMemo(() => getTimezoneName(), [])

  const effectiveIntervalMinutes = isCustomInterval
    ? Math.max(1, Math.floor(customIntervalValue || 0) * UNIT_MINUTES[customIntervalUnit])
    : intervalMinutes

  const showContinueOption = triggerType === "interval"
  const showAutoPROption = !isRepoLess
  const hasOptions = showContinueOption || showAutoPROption

  // Reset to defaults every time the popover opens, so stale values from a
  // previous open don't linger (matches useScheduledJobForm's reset-on-open
  // effect pattern).
  useEffect(() => {
    if (!open) return
    const mode = inferIntervalMode(1440)
    setTriggerType("interval")
    setIntervalMinutes(mode.intervalMinutes)
    setIsCustomInterval(mode.isCustom)
    setCustomIntervalValue(mode.customValue)
    setCustomIntervalUnit(mode.customUnit)
    setRunAtHourLocal(9)
    setRunAtDay(1)
    setAutoPR(true)
    setContinueFromLastRun(false)
    setFieldErrors({})
    setIncomingToken(null)
  }, [open])

  // Mint the incoming token lazily, only once the trigger flips to
  // "incoming" — mirrors useScheduledJobForm's own mint-on-flip effect.
  useEffect(() => {
    if (triggerType === "incoming" && !incomingToken) {
      setIncomingToken(crypto.randomUUID())
    }
  }, [triggerType, incomingToken])

  const incomingWebhookUrl = useMemo(() => {
    if (!incomingToken) return ""
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/wh/${incomingToken}`
  }, [incomingToken])

  const handleCopyUrl = () => {
    if (!incomingWebhookUrl) return
    void copyUrl(incomingWebhookUrl)
  }

  // No server-side URL exists yet pre-save, so "rotate" here is just minting
  // a fresh client-side token — same as useScheduledJobForm in create mode.
  const handleRotateToken = () => {
    setIncomingToken(crypto.randomUUID())
  }

  const clearFieldError = (field: ScheduledJobFormField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return {
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
  }
}
