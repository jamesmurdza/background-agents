"use client"

import { Fragment } from "react"
import { Github, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message } from "@/lib/types"
import type { SharedChat } from "@/lib/server/shared-chat"
import { MessageBubble } from "@/components/MessageBubble"

/** Minimal centered divider marking where inherited parent history ends. */
function BranchDivider() {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span>History above is inherited from the parent chat</span>
    </div>
  )
}

// =============================================================================
// SharedChatView — public, read-only rendering of a shared chat
// =============================================================================
//
// Reuses MessageBubble but never passes `onOpenFile`, so tool-call file
// references render as plain text (e.g. "Read: main.py") instead of clickable
// links. There is no input, no sidebar — viewing only.

interface SharedChatViewProps {
  chat: SharedChat
}

export function SharedChatView({ chat }: SharedChatViewProps) {
  const title = chat.displayName || "Shared chat"

  return (
    // Fixed viewport height + min-h-0 on the scroll region: the app shell sets
    // `body { overflow: hidden }`, so the page itself can't scroll — the
    // messages area must be its own scroll container.
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border shrink-0">
        <div className="max-w-3xl mx-auto w-full px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-foreground truncate">{title}</h1>
            {chat.repo && (
              <a
                href={`https://github.com/${chat.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
              >
                <Github className="h-3 w-3 shrink-0" />
                <span className="truncate">{chat.repo}</span>
              </a>
            )}
          </div>
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            Read-only
          </span>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 min-h-0 overflow-y-auto py-6 px-6">
        <div className="max-w-3xl mx-auto w-full space-y-6">
          {chat.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              This chat has no messages yet.
            </p>
          ) : (
            chat.messages.map((message, index) => {
              // A divider marks where the inherited parent history ends and this
              // branch's own conversation begins.
              const isBranchStart =
                !message.inherited && !!chat.messages[index - 1]?.inherited
              return (
                <Fragment key={message.id}>
                  {isBranchStart && <BranchDivider />}
                  <div className={cn(message.inherited && "opacity-60")}>
                    <MessageBubble
                      // SharedMessage carries the same fields MessageBubble reads;
                      // JSONB tool data is already sanitized server-side.
                      message={message as unknown as Message}
                      repo={chat.repo ?? undefined}
                      // No onOpenFile / onForcePush: file references render as text.
                    />
                  </div>
                </Fragment>
              )
            })
          )}
          {/* Branch with no own messages yet: the divider goes after the
              inherited history so it's clear the conversation continues below. */}
          {chat.messages.length > 0 &&
            chat.messages[chat.messages.length - 1]?.inherited && <BranchDivider />}
        </div>
      </main>
    </div>
  )
}
