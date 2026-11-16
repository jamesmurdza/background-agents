"use client"

import { useEffect, useState } from "react"
import type { Chat, TurnPhase } from "@/lib/types"

const LABELS: Record<TurnPhase, string> = {
  cleaning: "Cleaning up...",
  usage: "Calculating usage...",
  pushing: "Pushing to GitHub...",
  checking: "Checking changes...",
}

/**
 * Which step the server is on after the agent's last output ("Pushing to
 * GitHub..."), so the chat doesn't look like the agent is still running and a
 * step that hangs is visible. Undefined until finishing up has taken a second:
 * most turns get through it faster than anyone could read it.
 */
export function useTurnPhaseLabel(chat: Pick<Chat, "status" | "activeAssistantMessageId" | "turnPhase">): string | undefined {
  const turn = chat.turnPhase
  const phase = turn && chat.status === "running" && turn.assistantMessageId === chat.activeAssistantMessageId
    ? turn.phase
    : null
  const finishing = phase !== null
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!finishing) return
    const timer = setTimeout(() => setSlow(true), 1000)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [finishing])

  return slow && phase ? LABELS[phase] : undefined
}
