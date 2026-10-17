"use client"

import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import { supportsThinking, thinkingLabel } from "@background-agents/sdk/thinking"
import { useId, useState } from "react"
import { Brain } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"

export function ThinkingSelector({ capability, value, onChange, notice, onRetry, onOpenChange, checking = false, isMobile = false }: {
  capability: ThinkingCapability; value: string; onChange: (value: string) => void; notice?: string
  onRetry?: () => void; onOpenChange?: (open: boolean) => void; checking?: boolean; isMobile?: boolean
}) {
  const helpId = useId()
  const explanation = "Default uses the agent and model's own thinking setting, without an override. It does not select a different model or always mean Medium. Changes apply to future prompts."
  const selectedValue = value.startsWith("budget:") ? "budget" : value
  const selectionValid = supportsThinking(capability, value)
  const discoveryUnresolved = capability.status !== "available" && capability.status !== "no_controls"
  // Only a verified Default-only state is redundant. Keep uncertain discovery,
  // notices and incompatible saved choices visible for retry/explicit recovery.
  if (capability.status === "no_controls" && capability.levels.every(level => level === "default") &&
    !capability.budget && value === "default" && !notice) return null
  return <div className={cn("relative flex shrink-0 items-center gap-1 text-sm text-muted-foreground", isMobile && "max-w-[45%] flex-wrap justify-end")}>
    <Select value={selectedValue} onOpenChange={onOpenChange} onValueChange={next => onChange(next === "budget" && capability.budget ? `budget:${capability.budget.min}` : next)}>
      <SelectTrigger aria-label="Thinking level" aria-describedby={helpId} title={notice ?? capability.reason ?? explanation}
        aria-invalid={!selectionValid || undefined} aria-busy={checking}
        className={cn("h-auto w-auto max-w-full gap-1 border-0 bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2", isMobile && "min-h-9")}>
        <Brain aria-hidden="true" className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} /><SelectValue />
      </SelectTrigger>
      <SelectContent side="top" align="end" className="max-h-[min(28rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)]">
        <SelectItem value="default" title={explanation} aria-describedby={helpId}>Default</SelectItem>
        {!selectionValid && !capability.levels.includes(value as typeof capability.levels[number]) && !(selectedValue === "budget" && capability.budget) &&
          <SelectItem value={selectedValue} disabled>{thinkingLabel(value)} (needs review)</SelectItem>}
        {capability.levels.map(level => <SelectItem key={level} value={level}>{thinkingLabel(level)}</SelectItem>)}
        {capability.budget && <SelectItem value="budget">Token budget</SelectItem>}
        {capability.reason && <p className="w-64 max-w-full px-2 py-2 text-xs text-muted-foreground">{capability.reason}</p>}
        {onRetry && discoveryUnresolved && <button type="button" disabled={checking} onClick={onRetry}
          className="mx-2 mb-2 rounded border px-2 py-1 text-xs disabled:opacity-50">{checking ? "Checking…" : "Check again"}</button>}
      </SelectContent>
    </Select>
    {capability.budget && value.startsWith("budget:") && <BudgetInput key={value} value={value} range={capability.budget} onChange={onChange} />}
    <span id={helpId} className="sr-only">{explanation}{capability.reason && ` ${capability.reason}`}</span>
    {notice && <span role="status" className="absolute bottom-full right-0 mb-2 w-64 rounded border bg-popover p-2 text-popover-foreground shadow">{notice}</span>}
  </div>
}

function BudgetInput({ value, range, onChange }: { value: string; range: { min: number; max: number }; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value.slice(7))
  const valid = /^(?:0|[1-9]\d*)$/.test(draft) && Number(draft) >= range.min && Number(draft) <= range.max
  return <details className="relative">
    <summary className="cursor-pointer">{value.slice(7)} tokens</summary>
    <div className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded border bg-popover p-2 text-popover-foreground shadow">
      <label>Thinking tokens ({range.min}–{range.max})
        <input aria-label="Thinking token budget" type="number" min={range.min} max={range.max} step={1} value={draft} onChange={event => setDraft(event.target.value)} className="my-2 w-full rounded border bg-transparent p-1" />
      </label>
      <button type="button" disabled={!valid} onClick={() => onChange(`budget:${draft}`)} className="rounded border px-2 py-1 disabled:opacity-50">Apply budget</button>
      <p className="mt-1">Currently applied: {value.slice(7)} tokens. Changes apply after pressing Apply.</p>
    </div>
  </details>
}
