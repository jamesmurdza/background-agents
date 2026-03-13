"use client"

import type { Branch, Message } from "@/lib/types"
import { useExecutionPolling } from "./hooks"

interface BackgroundExecutionPollerProps {
  branch: Branch
  repoName: string
  onUpdateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  onAddMessage: (branchId: string, message: Message) => Promise<string>
  onForceSave: () => void
  onCommitsDetected?: () => void
  streamingMessageIdRef?: React.MutableRefObject<string | null>
}

/** Renders nothing; runs useExecutionPolling so non-active RUNNING branches keep receiving updates. */
export function BackgroundExecutionPoller({
  branch,
  repoName,
  onUpdateMessage,
  onUpdateBranch,
  onAddMessage,
  onForceSave,
  onCommitsDetected,
  streamingMessageIdRef,
}: BackgroundExecutionPollerProps) {
  useExecutionPolling({
    branch,
    repoName,
    onUpdateMessage,
    onUpdateBranch,
    onAddMessage,
    onForceSave,
    onCommitsDetected,
    streamingMessageIdRef,
  })
  return null
}
