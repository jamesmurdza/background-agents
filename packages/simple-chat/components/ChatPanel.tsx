"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Square, GitBranch, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat, Message } from "@/lib/types"
import { MessageBubble } from "./MessageBubble"

interface ChatPanelProps {
  chat: Chat | null
  onSendMessage: (message: string) => void
  onStopAgent: () => void
}

export function ChatPanel({ chat, onSendMessage, onStopAgent }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isRunning = chat?.status === "running"
  const isCreating = chat?.status === "creating"
  const canSend = input.trim() && !isRunning && !isCreating

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chat?.messages])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px"
    }
  }, [input])

  const handleSend = () => {
    if (!canSend) return
    onSendMessage(input.trim())
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // No chat selected - show welcome
  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h2 className="text-2xl font-semibold mb-2">Welcome to Simple Chat</h2>
          <p className="text-muted-foreground">
            Click "New Chat" to start a conversation with an AI coding agent.
            Select a repository and branch, then describe what you want to build.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{chat.repo}</span>
        <span className="text-muted-foreground">•</span>
        <span className="text-sm text-muted-foreground">
          {chat.branch || chat.baseBranch}
        </span>
        {chat.status === "creating" && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Creating sandbox...
          </span>
        )}
        {chat.status === "running" && (
          <span className="ml-auto flex items-center gap-1 text-xs text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Agent working...
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {chat.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <h3 className="text-lg font-medium mb-2">What would you like to build?</h3>
              <p className="text-sm text-muted-foreground">
                Describe your task and the AI agent will help you implement it.
                Changes will be committed to the branch:{" "}
                <span className="font-mono text-xs">{chat.branch || "(will be created)"}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {chat.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <div
            className={cn(
              "flex items-end gap-2 rounded-lg border px-3 py-2",
              "border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
            )}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isCreating
                  ? "Creating sandbox..."
                  : isRunning
                  ? "Agent is working..."
                  : "Describe what you want to build..."
              }
              rows={1}
              disabled={isCreating}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            />

            {isRunning ? (
              <button
                onClick={onStopAgent}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/80 text-white hover:bg-red-500 transition-colors"
              >
                <Square className="h-3 w-3" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                  canSend
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
