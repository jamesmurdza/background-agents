"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowUp, Square, ChevronDown, Github } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { MessageBubble } from "./MessageBubble"

interface ChatPanelProps {
  chat: Chat | null
  onSendMessage: (message: string) => void
  onStopAgent: () => void
  onChangeRepo?: () => void
}

export function ChatPanel({ chat, onSendMessage, onStopAgent, onChangeRepo }: ChatPanelProps) {
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
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
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

  // No chat selected - show loading state while creating
  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h2 className="text-2xl font-semibold mb-2">Loading...</h2>
        </div>
      </div>
    )
  }

  const isNewRepo = chat.repo === NEW_REPOSITORY
  const canChangeRepo = chat.messages.length === 0 && !chat.sandboxId
  const isNewChat = chat.messages.length === 0

  // Chat input component (used in two places)
  const chatInput = (
    <div className="w-full max-w-3xl mx-auto">
      <div
        className={cn(
          "flex flex-col rounded-2xl border shadow-sm",
          "border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
        )}
      >
        {/* Text input area */}
        <div className="flex items-end gap-2 px-4 py-3">
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
                : "Message..."
            }
            rows={1}
            disabled={isCreating}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
          />

          {isRunning ? (
            <button
              onClick={onStopAgent}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/80 text-white hover:bg-red-500 transition-colors cursor-pointer"
            >
              <Square className="h-3 w-3" />
            </button>
          ) : canSend ? (
            <button
              onClick={handleSend}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer transition-colors"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Bottom row with selectors */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border/50">
          {/* Repo selector */}
          {canChangeRepo && onChangeRepo ? (
            <button
              onClick={onChangeRepo}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {isNewRepo ? "New Repository" : chat.repo}
              <ChevronDown className="h-3 w-3" />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {isNewRepo ? "New Repository" : chat.repo}
              {!isNewRepo && chat.branch && ` • ${chat.branch}`}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Agent selector */}
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            OpenCode
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Model selector */}
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            Claude Sonnet
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )

  // New chat - centered welcome with input
  if (isNewChat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background p-4">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-semibold">What would you like to build?</h2>
        </div>
        {chatInput}
        <p className="text-sm text-muted-foreground mt-4">
          Agents work in an isolated sandbox and work on separate git branches.
        </p>
      </div>
    )
  }

  const chatTitle = chat.displayName || "Untitled"
  const githubBranchUrl = !isNewRepo && chat.branch
    ? `https://github.com/${chat.repo}/tree/${chat.branch}`
    : null

  // Chat with messages
  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header with title */}
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-medium text-foreground">{chatTitle}</h1>
        {githubBranchUrl && (
          <a
            href={githubBranchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="View branch on GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6 max-w-3xl mx-auto">
          {chat.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="p-4">
        {chatInput}
      </div>
    </div>
  )
}
