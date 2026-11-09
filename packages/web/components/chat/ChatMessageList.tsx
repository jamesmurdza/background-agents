import { Fragment, useEffect, useRef, useState } from "react"
import { MoreHorizontal, GitBranchPlus, Trash2, ArrowDown, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Agent } from "@/lib/types"
import type { GitContextValue } from "@/lib/contexts/GitContext"
import { ErrorBanner } from "./ErrorBanner"
import { BranchDivider } from "./BranchDivider"
import { MessageBubble } from "../MessageBubble"
import { getPendingSubmission } from "@/lib/chat-state"
import { latestFailedAssistant, persistedProviderFailure, unsupportedModelFailure } from "@/lib/turn-error-presentation"
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
  /** Opens the Changes panel, linked from the uncommitted-files warning. */
  onOpenChanges?: () => void
  /** Opens the repo-creation dialog, linked from the uncommitted-files
   * warning when the chat has no GitHub repo linked yet. */
  onCreateRepo?: () => void
  /** Opens the abort-merge/rebase confirmation dialog, linked from the
   * conflict banner. */
  onAbortConflict?: () => void
  onReload?: (chatId: string) => Promise<void> | void
  onSendMessage: (message: string, agent: string, model: string, files?: File[], planMode?: boolean, reasoningEffort?: string) => void
  onRemoveQueuedMessage?: (id: string) => void
  onResumeQueue?: () => Promise<void> | void
  onChooseModel?: () => void
  currentAgent: Agent
  currentModel: string
  currentReasoningEffort?: string
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
  onOpenChanges,
  onCreateRepo,
  onAbortConflict,
  onReload,
  onSendMessage,
  onRemoveQueuedMessage,
  onResumeQueue,
  onChooseModel,
  currentAgent,
  currentModel,
  currentReasoningEffort,
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

  // A push failure with a force-push recovery is surfaced as a standalone
  // banner (below) instead of inline in the conversation — it's an
  // actionable warning about the chat's current state, not a transcript
  // entry. At most one is ever outstanding (see clearPushFailureMessages).
  const forcePushFailure = chat.messages.find(
    (message) => message.isError && message.metadata?.action === "force-push"
  )

  // A merge attempted from a sandbox not checked out on the target branch
  // can't be replicated locally for conflict resolution, so the backend
  // points at rebase instead (see /api/sandbox/git's merge handler). Surfaced
  // as a banner rather than inline — and, unlike force-push, nothing clears
  // these out, so only the most recent one is shown/kept live.
  const rebaseSuggestions = chat.messages.filter(
    (message) => message.isError && message.metadata?.action === "rebase"
  )
  const rebaseSuggestion = rebaseSuggestions[rebaseSuggestions.length - 1]

  const rebaseConflict = git.rebaseConflict
  const inConflict = !!(rebaseConflict?.inRebase || rebaseConflict?.inMerge)
  const isMergeConflict = rebaseConflict?.inMerge ?? false

  // Hide the uncommitted-files/conflict banners the moment the user asks the
  // agent to commit/resolve, rather than leaving them up until the triggered
  // turn finishes and the server recomputes the underlying state. Resets —
  // so a banner can reappear if the turn didn't actually clear it — the next
  // time a turn completes, or immediately when switching to a different chat.
  const [commitRequested, setCommitRequested] = useState(false)
  const [resolveRequested, setResolveRequested] = useState(false)
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    setCommitRequested(false)
    setResolveRequested(false)
  }, [chat.id])
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      // The conflict banner's "in progress" state (git.rebaseConflict) is
      // otherwise only fetched once, on mount/sandbox change — so without
      // this, resetting resolveRequested here would make a successfully
      // resolved conflict's banner reappear showing stale mount-time state.
      // Re-check the sandbox first and only then reset — keeps the banner
      // hidden through the refresh instead of flashing the stale value
      // before the fresh one lands.
      setCommitRequested(false)
      void git.checkRebaseStatus().finally(() => setResolveRequested(false))
    }
    wasRunningRef.current = isRunning
  }, [isRunning, git.checkRebaseStatus])

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
                {isBranchStart && <BranchDivider />}
                {message !== forcePushFailure && !rebaseSuggestions.includes(message) && (
                  <div className={cn(message.inherited && "opacity-60")}>
                    <MessageBubble
                      message={message}
                      isStreaming={isLastAssistant}
                      isMobile={isMobile}
                      repo={isNewRepo ? undefined : chat.repo}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                )}
              </Fragment>
            )
          })}
          {/* Branch with no own messages yet: the divider goes after the
              inherited history so it's clear the user continues below it. */}
          {chat.messages.length > 0 &&
            chat.messages[chat.messages.length - 1]?.inherited && (
              <BranchDivider />
            )}
          {pending && (
            <div data-testid="pending-submission">
              <MessageBubble
                message={{ id: pending.userMessageId ?? pending.id, role: "user", content: pending.content, timestamp: 0 }}
                isMobile={isMobile}
              />
            </div>
          )}
          {/* A single placeholder until the active assistant row is available. */}
          {showStarting && (
            <div data-testid="starting-indicator" className="text-2xl text-muted-foreground animate-pulse">
              ...
            </div>
          )}
          {inConflict && !resolveRequested && (
            <div
              data-testid="conflict-warning"
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                A {isMergeConflict ? "merge" : "rebase"} conflict is in progress
                {rebaseConflict.conflictedFiles.length > 0 && (
                  <> ({rebaseConflict.conflictedFiles.length} file{rebaseConflict.conflictedFiles.length === 1 ? "" : "s"})</>
                )}.{" "}
                <button
                  type="button"
                  data-testid="conflict-resolve"
                  onClick={() => {
                    setResolveRequested(true)
                    onSendMessage(
                      `Resolve the ${isMergeConflict ? "merge" : "rebase"} conflict`,
                      currentAgent, currentModel, undefined, planModeEnabled, currentReasoningEffort
                    )
                  }}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  Resolve
                </button>{" "}
                or{" "}
                <button
                  type="button"
                  data-testid="conflict-abort"
                  onClick={onAbortConflict}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  abort
                </button>{" "}
                it.
              </span>
            </div>
          )}
          {rebaseSuggestion && (
            <div
              data-testid="rebase-suggestion"
              role="status"
              aria-busy={git.actionLoading}
              className={cn(
                "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground",
                git.actionLoading && "opacity-60 pointer-events-none"
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {rebaseSuggestion.content}{" "}
                <button
                  type="button"
                  data-testid="rebase-suggestion-action"
                  disabled={git.actionLoading}
                  onClick={() => {
                    if (rebaseSuggestion.linkBranch) git.rebaseOnto(rebaseSuggestion.linkBranch)
                  }}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer disabled:no-underline disabled:cursor-default"
                >
                  {git.actionLoading ? "Rebasing…" : "Rebase"}
                </button>{" "}
                onto {rebaseSuggestion.linkBranch ? `"${rebaseSuggestion.linkBranch}"` : "it"} before merging.
              </span>
            </div>
          )}
          {forcePushFailure && (
            <div
              data-testid="force-push-warning"
              role="status"
              aria-busy={git.actionLoading}
              className={cn(
                "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground",
                git.actionLoading && "opacity-60 pointer-events-none"
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {forcePushFailure.content.replace(/\s*You can force push to overwrite the remote history\.?$/, "")}{" "}
                <button
                  type="button"
                  data-testid="force-push-action"
                  disabled={git.actionLoading}
                  onClick={git.handleForcePush}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer disabled:no-underline disabled:cursor-default"
                >
                  {git.actionLoading ? "Force pushing…" : "Force push"}
                </button>{" "}
                to overwrite the remote history.
              </span>
            </div>
          )}
          {isNewRepo && ((chat.uncommittedFilesCount ?? 0) > 0 || chat.hasCommits) && (
            <div
              data-testid="uncommitted-files-warning"
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Your changes will be lost unless you commit them.{" "}
                {onCreateRepo ? (
                  <button
                    type="button"
                    data-testid="uncommitted-files-create-repo"
                    onClick={onCreateRepo}
                    className="underline underline-offset-2 hover:no-underline cursor-pointer"
                  >
                    Create a repo
                  </button>
                ) : (
                  "Create a repo"
                )}{" "}
                to save your work.
              </span>
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
                You have {chat.uncommittedFilesCount} uncommitted{" "}
                {chat.uncommittedFilesCount === 1 ? "file" : "files"}.{" "}
                {onOpenChanges && (
                  <>
                    <button
                      type="button"
                      onClick={onOpenChanges}
                      className="underline underline-offset-2 hover:no-underline cursor-pointer"
                    >
                      Review
                    </button>{" "}
                    or{" "}
                  </>
                )}
                <button
                  type="button"
                  data-testid="uncommitted-files-commit"
                  onClick={() => {
                    setCommitRequested(true)
                    onSendMessage("Commit changes", currentAgent, currentModel, undefined, planModeEnabled, currentReasoningEffort)
                  }}
                  className="underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  {onOpenChanges ? "commit" : "Commit"}
                </button>{" "}
                {chat.uncommittedFilesCount === 1 ? "it" : "them"}.
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
          {chat.status === "error" && (() => {
            const providerFailure = persistedProviderFailure(chat)
            const failureMessage = providerFailure || unsupportedModelFailure(chat.errorMessage) || chat.errorMessage
            const unsupportedModel = !!unsupportedModelFailure(failureMessage)
            const lastUserMessage = [...chat.messages].reverse().find((m) => m.role === "user")
            const resend = lastUserMessage
              ? () => onSendMessage(
                  lastUserMessage.content,
                  currentAgent,
                  currentModel,
                  undefined,
                  planModeEnabled,
                  currentReasoningEffort,
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
            const lastAssistant = providerFailure ? latestFailedAssistant(chat)
              : [...chat.messages].reverse().find((m) => m.role === "assistant" && !m.isError)
            const recoveredOutput =
              !!lastAssistant?.content?.trim() || (lastAssistant?.toolCalls?.length ?? 0) > 0
            const useReload =
              !!onReload &&
              ((!failureMessage && recoveredOutput) || waiting.length > 0 || chat.errorKind === "incomplete" ||
                (!!providerFailure && recoveredOutput) ||
                (chat.errorKind === "crash" && recoveredOutput))
            const canContinue = waiting.length > 0 && !!chat.recoverableAssistantMessageId && !!onResumeQueue

            return (
              <ErrorBanner
                key={chat.id}
                message={failureMessage || (canContinue
                  ? "The last run stopped before it finished. Queued prompts have not been sent."
                  : useReload ? "The last run stopped before it finished. Reload to check its saved output."
                  : "The last run stopped before it finished.")}
                isMobile={isMobile}
                onRetry={unsupportedModel ? onChooseModel : canContinue ? onResumeQueue : useReload ? () => onReload!(chat.id) : resend}
                actionLabel={unsupportedModel ? "Choose model" : canContinue ? "Continue queued prompts" : useReload ? "Reload" : "Retry"}
                actionPendingLabel={unsupportedModel ? "Choose model" : canContinue ? "Continuing…" : useReload ? "Reloading…" : "Retrying…"}
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
                          onClick={() => git.handleBranchQueuedMessage(m.id, m.content, m.agent, m.model, m.reasoningEffort)}
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
