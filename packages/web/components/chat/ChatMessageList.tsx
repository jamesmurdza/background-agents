import { Plus, X, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ErrorBanner } from "./ErrorBanner"
import { MessageBubble } from "../MessageBubble"

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
            return (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isLastAssistant}
                isMobile={isMobile}
                repo={isNewRepo ? undefined : chat.repo}
                onOpenFile={onOpenFile}
                onForcePush={git.handleForcePush}
              />
            )
          })}
          {/* Show loading indicator when sandbox is being created */}
          {isCreating && (
            <div className="text-2xl text-muted-foreground animate-pulse">
              ...
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
          {chat.status === "error" && chat.errorMessage && (() => {
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
              (chat.errorKind === "incomplete" ||
                (chat.errorKind === "crash" && recoveredOutput))

            return (
              <ErrorBanner
                key={chat.id}
                message={chat.errorMessage}
                isMobile={isMobile}
                onRetry={useReload ? () => onReload!(chat.id) : resend}
                actionLabel={useReload ? "Reload" : "Retry"}
                actionPendingLabel={useReload ? "Reloading…" : "Retrying…"}
              />
            )
          })()}
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
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">{m.content}</span>
                  {git.canBranch && (
                    <button
                      onClick={() => git.handleBranchQueuedMessage(m.id, m.content, m.agent, m.model)}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                      aria-label="Branch to new chat"
                      title="Branch to new chat"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  )}
                  {onRemoveQueuedMessage && (
                    <button
                      onClick={() => onRemoveQueuedMessage(m.id)}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                      aria-label="Remove queued message"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
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
