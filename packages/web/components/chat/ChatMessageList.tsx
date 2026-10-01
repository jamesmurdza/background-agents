import { Fragment, useEffect, useRef } from "react"
import { MoreHorizontal, GitBranch, GitBranchPlus, Trash2, ArrowDown, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ErrorBanner } from "./ErrorBanner"
import { MessageBubble } from "../MessageBubble"
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
 * Shared-pool credential failures that are safe to retry automatically: the
 * shared Claude OAuth session occasionally dies within seconds of the hourly
 * credential-refresh cron rotating it (see CcAuthRun investigation) — a
 * transient hiccup unrelated to anything the user did, which a plain resend
 * usually clears. Matched narrowly (not the whole "auth" category) because
 * most auth failures — a bad personal API key, a revoked grant — won't be
 * fixed by resending and would just loop the user through duplicate turns.
 */
const AUTO_RETRY_ERROR_PATTERN =
  /Failed to authenticate: OAuth session expired and could not be refreshed/i

/** One automatic retry per chat's current error streak — if it fails again
 *  (same cause or not), fall back to the normal manual Retry banner instead
 *  of silently looping. */
const MAX_AUTO_RETRIES_PER_CHAT = 1

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
  currentAgent,
  currentModel,
  planModeEnabled,
  messagesContainerRef,
  messagesEndRef,
  onScroll,
  userHasScrolledUp,
  onScrollToBottom,
}: ChatMessageListProps) {
  // Mirrors the Retry action's own logic (see the ErrorBanner render below) so
  // the auto-retry effect and the manual button fire the exact same resend.
  const lastUserMessage = [...chat.messages].reverse().find((m) => m.role === "user")
  const resend = lastUserMessage
    ? () => onSendMessage(
        lastUserMessage.content,
        (lastUserMessage.agent ?? currentAgent) as string,
        lastUserMessage.model ?? currentModel,
        undefined,
        planModeEnabled,
      )
    : undefined

  // A generic process crash is often transient. If the failed turn already
  // streamed some output, the fuller copy is likely persisted server-side, so
  // offer Reload (refresh history) instead of Retry (which resends and
  // duplicates the turn). With nothing to recover — the agent crashed before
  // producing anything — fall back to Retry.
  //
  // "incomplete" means the turn ended with no terminal event: the agent may
  // still be running in the background, so always Reload (refresh history)
  // rather than resending and risking a duplicate run.
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant")
  const recoveredOutput =
    !!lastAssistant?.content?.trim() || (lastAssistant?.toolCalls?.length ?? 0) > 0
  const useReload =
    !!onReload &&
    (chat.errorKind === "incomplete" ||
      (chat.errorKind === "crash" && recoveredOutput))

  // Tracks how many times we've auto-retried THIS chat's current error
  // streak. Keyed by chat id and reset whenever the chat leaves the error
  // status (a later, unrelated failure still gets its own automatic attempt).
  const autoRetryCountRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (chat.status !== "error") {
      autoRetryCountRef.current.delete(chat.id)
      return
    }
    if (useReload) return // a different recovery action applies here, not resend
    if (!resend || !chat.errorMessage) return
    if (!AUTO_RETRY_ERROR_PATTERN.test(chat.errorMessage)) return

    const attempts = autoRetryCountRef.current.get(chat.id) ?? 0
    if (attempts >= MAX_AUTO_RETRIES_PER_CHAT) return

    autoRetryCountRef.current.set(chat.id, attempts + 1)
    resend()
    // Only the signal that defines a *new* failure to react to — not `resend`
    // itself, which is a fresh closure every render and would otherwise
    // re-fire this effect on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, chat.status, chat.errorMessage, useReload])

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
            const isLastAssistant =
              isRunning &&
              message.role === "assistant" &&
              index === chat.messages.length - 1
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
          {/* Show loading indicator when sandbox is being created */}
          {isCreating && (
            <div className="text-2xl text-muted-foreground animate-pulse">
              ...
            </div>
          )}
          {chat.hasUncommittedFiles && !isNewRepo && (
            <div
              data-testid="uncommitted-files-warning"
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Some new files were uncommitted at the end of the last agent turn,
                so they were not included in a pushed commit. Ask the agent to
                review and commit the files you want to save on GitHub.
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
                objects are no longer in memory). A narrow subset of "error"
                (the shared Claude credential's transient OAuth hiccup, see
                AUTO_RETRY_ERROR_PATTERN above) auto-fires this same resend once
                before the banner ever renders, instead of waiting on the user.
              - "disconnected": the SSE stream died before the turn finished. The
                agent may still be running in the background, so the action is
                Reload (refresh the chat history) rather than resending. */}
          {chat.status === "disconnected" && (
            <ErrorBanner
              key={chat.id}
              message={chat.errorMessage || "Connection to the agent was lost."}
              isMobile={isMobile}
              onRetry={onReload ? () => onReload(chat.id) : undefined}
              actionLabel="Reload"
              actionPendingLabel="Reloading…"
            />
          )}
          {chat.status === "error" && chat.errorMessage && (
            <ErrorBanner
              key={chat.id}
              message={chat.errorMessage}
              isMobile={isMobile}
              onRetry={useReload ? () => onReload!(chat.id) : resend}
              actionLabel={useReload ? "Reload" : "Retry"}
              actionPendingLabel={useReload ? "Reloading…" : "Retrying…"}
            />
          )}
          {/* Queue shelf — lives at the bottom of the scroll area so it
              scrolls out of view with the conversation. */}
          {chat.queuedMessages && chat.queuedMessages.length > 0 && (
            <div className={cn(
              "border border-b-0 border-border bg-card rounded-t-md -mb-4",
              isMobile ? "mx-4" : "mx-6"
            )}>
              {chat.queuedMessages.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-foreground/80">{m.content}</div>
                    {m.pendingSync && <div className="text-xs text-muted-foreground">Saving to queue…</div>}
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
                        <DropdownMenuItem onClick={() => onRemoveQueuedMessage(m.id)}>
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
