"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import { supportsThinking, variantChoice, THINKING_BROWSER_TIMEOUT_MS } from "@background-agents/sdk/thinking"
import { thinkingCapability, verifiedThinkingCapability } from "@/lib/thinking"

type DiscoveryStatus = NonNullable<ThinkingCapability["status"]>
const DISCOVERY_STATUSES: DiscoveryStatus[] = ["available", "no_controls", "unverified", "runtime_unavailable", "check_failed"]
const RETRY_AFTER_MS = 5_000
const REVALIDATE_AFTER_MS = 60_000
const MAX_OPPORTUNISTIC_RETRIES = 2

/** Chat lifecycle hints are not sandbox state: a stopped sandbox can have a ready chat. */
export interface ThinkingPreferenceContext { readinessKey?: string; isStarting?: boolean }

function decodeCapability(value: unknown, expected: ThinkingCapability): ThinkingCapability {
  if (!value || typeof value !== "object") throw new Error("Invalid capabilities")
  const candidate = value as ThinkingCapability
  if (!Array.isArray(candidate.levels)) throw new Error("Invalid capabilities")
  if (candidate.status !== undefined && !DISCOVERY_STATUSES.includes(candidate.status)) throw new Error("Invalid capability status")
  const variants = expected.control === "opencode-variant" || expected.control === "kilo-variant"
  const levels = candidate.levels.filter(level => typeof level === "string" && level !== "default" && (
    supportsThinking(expected, level) || variants && level.startsWith("variant:") && variantChoice(level.slice(8)) === level
  ))
  // Preserve valid controls when one advertised entry is malformed. An entirely
  // unusable non-empty catalog is a failed lookup, not proof of no controls.
  if (candidate.levels.length && !levels.length) throw new Error("Invalid capabilities")
  if (candidate.budget !== undefined && JSON.stringify(candidate.budget) !== JSON.stringify(expected.budget)) throw new Error("Invalid budget")
  const hasControls = levels.length > 0 || candidate.budget !== undefined
  if (candidate.status === "available" && !hasControls || candidate.status === "no_controls" && hasControls) throw new Error("Contradictory capability status")
  return { ...candidate, levels: [...new Set(levels)], status: candidate.status ?? (hasControls ? "available" : "unverified") }
}

export function useThinkingPreference(agent: string, model: string, chatId?: string, sandboxId?: string | null, context: ThinkingPreferenceContext = {}) {
  const key = `backgrounder-thinking:${JSON.stringify([agent, model])}`
  const runtimeKey = JSON.stringify([chatId, sandboxId, agent, model])
  const lifecycleKey = JSON.stringify([runtimeKey, context.readinessKey, context.isStarting])
  const expected = thinkingCapability(agent, model)
  // Expected policy describes legal inputs, not evidence for first-prompt UI.
  // Codex/Claude must also use recorded evidence and the actual sandbox context.
  const initial = verifiedThinkingCapability(agent, model)
  const hasRuntimeControls = !!expected.control && (expected.levels.length > 0 || !!expected.budget)
  const needsRuntime = hasRuntimeControls && !!sandboxId && !!chatId && !chatId.startsWith("draft-")
  const [runtime, setRuntime] = useState<{ key: string; capability: ThinkingCapability }>()
  const verified = useRef(new Map<string, ThinkingCapability>())
  const [pending, setPending] = useState<string>()
  const [revision, setRevision] = useState(0)
  const lastRequest = useRef<{ key: string; revision: number; at: number; complete: boolean; duringStartup: boolean } | undefined>(undefined)
  const lifecycle = useRef({ key: runtimeKey, starting: context.isStarting })
  const retryState = useRef({ lifecycleKey, lastStarted: 0, automatic: 0 })
  const checking = needsRuntime && pending === runtimeKey
  const current = runtime?.key === runtimeKey ? runtime.capability : undefined
  const fallback = verified.current.get(runtimeKey) ?? initial
  const capability: ThinkingCapability = !current ? initial
    : current.status !== "check_failed" && current.status !== "runtime_unavailable" ? current
    : { ...fallback, ...current, levels: fallback.levels, budget: fallback.budget }
  const [selection, setSelection] = useState({ key: "", value: "default" })
  const [storageNotice, setStorageNotice] = useState<string>()
  const memory = useRef(new Map<string, string>())

  useEffect(() => {
    const finishedStarting = lifecycle.current.key === runtimeKey && lifecycle.current.starting === true && !context.isStarting
    lifecycle.current = { key: runtimeKey, starting: context.isStarting }
    if (!needsRuntime) return
    // Starting/working/ready describe turns, not actual sandbox availability.
    // A result read during preparation can belong to the pre-upgrade runtime.
    // Recheck that result once preparation finishes, regardless of stale time.
    // Otherwise only stale catalogs or uncertain checks need lifecycle retries.
    const recheckAfterStartup = finishedStarting && (lastRequest.current?.duringStartup ||
      Date.now() - (lastRequest.current?.at ?? 0) >= REVALIDATE_AFTER_MS)
    if (lastRequest.current?.key === runtimeKey && lastRequest.current.revision === revision && lastRequest.current.complete &&
      (current?.status === "available" || current?.status === "no_controls") && !recheckAfterStartup) return
    const request = { key: runtimeKey, revision, at: Date.now(), complete: false, duringStartup: context.isStarting === true }
    lastRequest.current = request
    if (retryState.current.lifecycleKey !== lifecycleKey) retryState.current = { lifecycleKey, lastStarted: 0, automatic: 0 }
    retryState.current.lastStarted = Date.now()
    const controller = new AbortController()
    setPending(runtimeKey)
    const unavailable: ThinkingCapability = { levels: [], status: "check_failed", reason: "Could not check this sandbox's thinking support. Your selection is kept. Retry the check or choose Default." }
    const finish = (value: ThinkingCapability) => {
      if (controller.signal.aborted) return
      request.complete = true
      if (value.status === "available" || value.status === "no_controls" || value.status === "unverified") verified.current.set(runtimeKey, value)
      setRuntime({ key: runtimeKey, capability: value })
      setPending(previous => previous === runtimeKey ? undefined : previous)
    }
    const timer = setTimeout(() => { finish(unavailable); controller.abort() }, THINKING_BROWSER_TIMEOUT_MS)
    const query = new URLSearchParams({ agent, model })
    void fetch(`/api/chats/${encodeURIComponent(chatId!)}/thinking?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Capability lookup failed")
        finish(decodeCapability(await response.json(), expected))
      })
      .catch(() => finish(unavailable))
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); controller.abort() }
    // Agent/model and sandbox identity are encoded in lifecycleKey. Rebuilding
    // a capability object on render must not create an endless request loop.
  }, [lifecycleKey, needsRuntime, revision])

  useLayoutEffect(() => {
    let saved = memory.current.get(key)
    let warning: string | undefined
    try { saved ??= localStorage.getItem(key) ?? undefined } catch {
      warning = "Thinking preferences cannot be saved on this device. Your selection still applies to this tab."
    }
    const value = saved || "default"
    // Uncertainty must never rewrite a user's explicit preference.
    memory.current.set(key, value)
    setSelection({ key, value })
    setStorageNotice(warning)
  }, [key])

  const thinking = selection.key === key ? selection.value : memory.current.get(key) ?? "default"
  const selectionValid = supportsThinking(capability, thinking)
  const notice = !selectionValid
    ? capability.status === "available" || capability.status === "no_controls"
      ? "Your selected thinking setting is not available for this model/runtime. Choose a supported setting or Default before sending."
      : "Your selected thinking setting has not been verified here. It is kept; retry the check or explicitly choose Default before sending."
    : storageNotice

  const recheckThinking = useCallback(() => {
    if (!needsRuntime || checking) return
    retryState.current.automatic = 0
    setRevision(value => value + 1)
  }, [needsRuntime, checking])
  const onThinkingMenuOpen = useCallback((open = true) => {
    if (!open || !needsRuntime || checking) return
    const retry = retryState.current
    if (capability.status === "available" || capability.status === "no_controls") {
      // Chat does not expose sandbox lifecycle events. A sandbox restarted
      // externally with the same ID is observed on the next focus/menu action,
      // with a stale-time bound instead of a perpetual background polling loop.
      if (Date.now() - retry.lastStarted < REVALIDATE_AFTER_MS) return
      retry.automatic = 0
      setRevision(value => value + 1)
      return
    }
    if (retry.automatic >= MAX_OPPORTUNISTIC_RETRIES || Date.now() - retry.lastStarted < RETRY_AFTER_MS) return
    retry.automatic += 1
    setRevision(value => value + 1)
  }, [needsRuntime, checking, capability.status])
  useEffect(() => {
    const onFocus = () => onThinkingMenuOpen()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [onThinkingMenuOpen])

  function setThinking(value: string) {
    if (!supportsThinking(capability, value)) return
    memory.current.set(key, value)
    setSelection({ key, value })
    setStorageNotice(undefined)
    try { localStorage.setItem(key, value) } catch {
      setStorageNotice("Thinking preferences could not be saved. Your selection still applies to this tab.")
    }
  }
  // Recovery retains the original intent without silently consenting to Default
  // or altering the stored preference for a different model.
  const requestThinking = useCallback((value: string) => { setSelection({ key, value: value || "default" }) }, [key])
  return { thinking, setThinking, capability, notice, ready: selection.key === key && selectionValid, selectionValid, checking, recheckThinking, onThinkingMenuOpen, requestThinking, canRecheck: needsRuntime }
}
