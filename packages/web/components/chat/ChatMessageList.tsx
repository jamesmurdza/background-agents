import { Fragment, useEffect, useRef, useState } from "react"
import { MoreHorizontal, GitBranch, GitBranchPlus, Trash2, ArrowDown, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ErrorBanner } from "./ErrorBanner"
import { MessageBubble } from "../MessageBubble"
import { getPendingSubmission } from "@/lib/chat-state"
import { persistedProviderFailure } from "@/lib/turn-error-presentation"
import { dismissDirectSend } from "@/lib/direct-send-recovery"
import { useToastStore } from "@/lib/stores/toast-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ChatMessageListProps {
  chat: Chat
  isMobile: boolean
  isRunning: boolean
  isCreating: boolean
  isNewRepo: boolean
  git: GitContextValue
  onOpenFile?: (filePath: string) => void
  onReload?: (chatId: string) => Promise<void> | void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => void
  onRemoveQueuedMessage?: (id: string) => void
  onResumeQueue?: () => Promise<void> | void
  currentAgent: Agent
  currentModel: string
  planModeEnabled: boolean
  messagesContainerRef: React.RefObject<HTMLDivElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  userHasScrolledUp: boolean
  onScrollToBottom: () => void
}

/**
 * The scrollable conversation region: message bubbles, the creating indicator,
 * inline error/disconnected banners (with Retry vs Reload recovery), the queued-
 * message shelf, and the floating scroll-to-bottom button.
 */
export function ChatMessageList({
  chat,
  isMobile,
  isRunning,
  isCreating,
  isNewRepo,
  git,
  onOpenFile,
  onReload,
  onSendMessage,
  onRemoveQueuedMessage,
  onResumeQueue,
  currentAgent,
  currentModel,
  planModeEnabled,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  userHasScrolledUp,
  onScrollToBottom,
}: ChatMessageListProps) {
  const visibleQueue = (chat.queuedMessages ?? []).filter((item) =>
    !item.userMessageId || !chat.messages.some((message) => message.id === item.userMessageId))
  const pending = getPendingSubmission({ ...chat, queuedMessages: visibleQueue })
  const waiting = visibleQueue.filter((item) => item !== pending)
  const activeMessage = chat.messages.find((message) => message.id === chat.activeAssistantMessageId && message.role === "assistant")
  const streamingId = (chat.status === "running" || chat.status === "creating") ? activeMessage?.id : undefined
  const showStarting = !streamingId && (isCreating || chat.status === "running" || !!pending)
  const directRecovery = chat.pendingSend ? [] : (chat.directSendRecovery ?? [])

  // Hide the uncommitted-files banner the moment the user asks the agent to
  // commit, rather than leaving it up until the triggered turn finishes and
  // the server recomputes the count. Resets — so the banner can reappear if
  // the commit didn't actually clear it — the next time a turn completes, or
  // immediately when switching to a different chat.
  const [commitRequested, setCommitRequested] = useState(false)
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    setCommitRequested(false)
  }, [chat.id])
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      setCommitRequested(false)
    }
    wasRunningRef.current = isRunning
  }, [isRunning])

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div
        ref={messagesContainerRef}
        onScroll={onScroll}
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden mobile-scroll scrollbar-auto-hide",
          isMobile ? "py-3 px-[27px]" : "py-4 px-[31px]"
        )}
      >
        <div className={cn(
          "space-y-4 mx-auto",
          isMobile ? "max-w-full" : "max-w-3xl space-y-6"
        )}>
          {chat.messages.map((message, index) => {
            const isLastAssistant = message.id === streamingId
            // A divider marks the point where the inherited parent history ends
            // and this branch's own conversation begins.
            const isBranchStart =
              !message.inherited && !!chat.messages[index - 1]?.inherited
            return (
              <Fragment key={message.id}>
                {isBranchStart && <BranchDivider isMobile={isMobile} />}
                <div className={cn(message.inherited && "opacity-60")}>
                  <MessageBubble
                    message={message}
                    isStreaming={isLastAssistant}
                    isMobile={isMobile}
                    repo={isNewRepo ? undefined : chat.repo}
                    onOpenFile={onOpenFile}
                    onForcePush={git.handleForcePush}
                  />
                </div>
              </Fragment>
            )
          })}
          {/* Branch with no own messages yet: the divider goes after the
              inherited history so it's clear the user continues below it. */}
          {chat.messages.length > 0 &&
            chat.messages[chat.messages.length - 1]?.inherited && (
              <BranchDivider isMobile={isMobile} />
            )}
          {pending && (
            <div data-testid="pending-submission">
              <MessageBubble
                message={{ id: pending.userMessageId ?? pending.id, role: "user", content: pending.content, timestamp: 0 }}
                isMobile={isMobile}
              />
              <div className="text-xs text-muted-foreground text-right mt-1">
                {pending.pendingSync && !pending.userMessageId ? "Sending…" : "Starting…"}
              </div>
            </div>
          )}
          {/* A single placeholder until the active assistant row is available. */}
          {showStarting && (
            <div data-testid="starting-indicator" className="text-2xl text-muted-foreground animate-pulse">
              ...
            </div>
          )}
          {(chat.uncommittedFilesCount ?? 0) > 0 && !isNewRepo && !commitRequested && (
            <div
              data-testid="uncommitted-files-warning"
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                You have {chat.uncommittedFilesCount} new uncommitted{" "}
                {chat.uncommittedFilesCount === 1 ? "file" : "files"}.{" "}
                <button
                  type="button"
                  data-testid="uncommitted-files-commit"
                  onClick={() => {
                    setCommitRequested(true)
                    onSendMessage("Commit changes", currentAgent, currentModel, undefined, planModeEnabled)
                  }}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  Commit your changes
                </button>{" "}
                to save these files.
              </span>
            </div>
          )}
          {/* Surface the latest agent/streaming failure inline so users see why
              their last run stopped. Cleared on the next send.

              Two distinct failure modes, distinguished by chat.status:
              - "error": the agent itself errored. The Retry action resends the
                last user message — note this leaves the previously-failed
                assistant turn in the history (the user can see what failed) and
                doesn't re-attach any originally-uploaded files (those File
                objects are no longer in memory).
              - "disconnected": the SSE stream died before the turn finished. The
                agent may still be running in the background, so the action is
                Reload (refresh the chat history) rather than resending. */}
          {directRecovery.map((item) => (
            <div key={item.id} data-testid="direct-send-recovery" className="space-y-2">
              {!chat.messages.some((message) => message.id === item.userMessageId) && (
                <MessageBubble message={{ id: item.id, role: "user", content: item.content, timestamp: item.directSend?.timestamp ?? 0 }} isMobile={isMobile} />
              )}
              <div>
                <ErrorBanner
                  message="Send status is unconfirmed. This is a copy saved on this device. Reload to check whether the server received it. It will not be resent automatically."
                  isMobile={isMobile}
                  onRetry={onReload ? () => onReload(chat.id) : undefined}
                  actionLabel="Reload"
                  actionPendingLabel="Reloading…"
                />
              </div>
              {item.directSend?.error && <p className="text-xs text-muted-foreground">{item.directSend.error}</p>}
              {!!item.directSend?.attachmentNames?.length && <p className="text-xs text-muted-foreground">Attachments are not saved on this device. Reattach them if you send again: {item.directSend.attachmentNames.join(", ")}</p>}
              <div className="flex gap-3 text-xs">
                <button type="button" className="underline" onClick={() => {
                  void navigator.clipboard.writeText(item.content).catch(() => useToastStore.getState().addToast({ title: "Could not copy prompt", body: "Select and copy the prompt text above.", chatId: chat.id }))
                }}>Copy prompt</button>
                <button type="button" className="underline" onClick={() => dismissDirectSend(chat.id, item.id)}>Dismiss local copy</button>
              </div>
              <p className="text-xs text-muted-foreground">Dismissing this copy does not stop or cancel a server run.</p>
            </div>
          ))}
          {chat.status === "disconnected" && directRecovery.length === 0 && (
            <ErrorBanner
              key={chat.id}
              message={chat.errorMessage || "Connection to the agent was lost."}
              isMobile={isMobile}
              onRetry={onReload ? () => onReload(chat.id) : undefined}
              actionLabel="Reload"
              actionPendingLabel="Reloading…"
            />
          )}
          {chat.status === "error" && directRecovery.length === 0 && (() => {
            const providerFailure = persistedProviderFailure(chat)
            const failureMessage = providerFailure || chat.errorMessage
            const lastUserMessage = [...chat.messages].reverse().find((m) => m.role === "user")
            const resend = lastUserMessage
              ? () => onSendMessage(
                  lastUserMessage.content,
                  currentAgent,
                  currentModel,
                  undefined,
                  planModeEnabled,
                )
              : undefined

            // A generic process crash is often transient. If the failed turn
            // already streamed some output, the fuller copy is likely persisted
            // server-side, so offer Reload (refresh history) instead of Retry
            // (which resends and duplicates the turn). With nothing to recover —
            // the agent crashed before producing anything — fall back to Retry.
            //
            // "incomplete" means the turn ended with no terminal event: the agent
            // may still be running in the background, so always Reload (refresh
            // history) rather than resending and risking a duplicate run.
            const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant")
            const recoveredOutput =
              !!lastAssistant?.content?.trim() || (lastAssistant?.toolCalls?.length ?? 0) > 0
            const useReload =
              !!onReload &&
              (!failureMessage || waiting.length > 0 || chat.errorKind === "incomplete" ||
                (!!providerFailure && recoveredOutput) ||
                (chat.errorKind === "crash" && recoveredOutput))
            const canContinue = waiting.length > 0 && !!chat.recoverableAssistantMessageId && !!onResumeQueue

            return (
              <ErrorBanner
                key={chat.id}
                message={failureMessage || (canContinue
                  ? "The last run stopped before it finished. Queued prompts have not been sent."
                  : "The last run stopped before it finished. Reload to check its saved output.")}
                isMobile={isMobile}
                onRetry={canContinue ? onResumeQueue : useReload ? () => onReload!(chat.id) : failureMessage ? resend : undefined}
                actionLabel={canContinue ? "Continue queued prompts" : useReload ? "Reload" : "Retry"}
                actionPendingLabel={canContinue ? "Continuing…" : useReload ? "Reloading…" : "Retrying…"}
              />
            )
          })()}
          {/* Queue shelf — lives at the bottom of the scroll area so it
              scrolls out of view with the conversation. */}
          {waiting.length > 0 && (
            <div data-testid="prompt-queue" className={cn(
              "border border-b-0 border-border bg-card rounded-t-md -mb-4",
              isMobile ? "mx-4" : "mx-6"
            )}>
              {waiting.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-foreground/80">{m.content}</div>
                    {m.cancelRequested && <div className="text-xs text-muted-foreground">Removal pending confirmation…</div>}
                    {m.pendingSync && !m.syncError && !m.cancelRequested && <div className="text-xs text-muted-foreground">Saving to queue…</div>}
                    {m.syncError && <div className="text-xs text-destructive">
                      {m.cancelRequested || m.cancelFailed ? "Could not confirm removal: " : m.syncFailed ? "Not sent: " : "Send status unconfirmed: "}{m.syncError}
                      {!m.syncFailed && " — retrying when the connection recovers."}
                    </div>}
                    {m.lastError && <div className="text-xs text-destructive">Paused: {m.lastError}</div>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                        aria-label="More actions"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                      {git.canBranch && (
                        <DropdownMenuItem
                          onClick={() => git.handleBranchQueuedMessage(m.id, m.content, m.agent, m.model)}
                        >
                          <GitBranchPlus className="h-3.5 w-3.5 mr-2" />
                          Branch to new chat
                        </DropdownMenuItem>
                      )}
                      {onRemoveQueuedMessage && (
                        <DropdownMenuItem disabled={m.cancelRequested} onClick={() => onRemoveQueuedMessage(m.id)}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Remove from queue
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      {/* Floating scroll-to-bottom button — only shown when the user has
          scrolled away from the bottom of the conversation. */}
      {userHasScrolledUp && (
        <button
          type="button"
          onClick={onScrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 h-9 w-9 flex items-center justify-center rounded-full border border-border bg-background/80 shadow-md text-foreground/70 hover:text-foreground hover:bg-background transition-colors cursor-pointer animate-in fade-in slide-in-from-bottom-1 duration-150"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/**
 * Marks where the inherited parent history (shown for context, rendered muted)
 * ends and this branch's own conversation begins. Minimal centered divider.
 */
function BranchDivider({ isMobile: _isMobile }: { isMobile: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span>History above is inherited from the parent chat</span>
    </div>
  )
}
