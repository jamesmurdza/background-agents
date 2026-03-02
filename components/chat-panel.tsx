"use client"

import { cn } from "@/lib/utils"
import type { Branch, Message, ToolCall, Agent } from "@/lib/mock-data"
import { agentLabels } from "@/lib/mock-data"
import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  Terminal,
  GitPullRequest,
  ExternalLink,
  ChevronDown,
  Send,
  ArrowRight,
  Loader2,
  GitMerge,
  GitCompareArrows,
  GitFork,
  Tag,
  RotateCcw,
  History,
  Diff,
} from "lucide-react"
import { useState, useRef, useEffect } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function ToolCallIcon({ type }: { type: ToolCall["type"] }) {
  const cls = "h-3 w-3"
  switch (type) {
    case "read_file":
      return <FileText className={cls} />
    case "edit_file":
      return <Pencil className={cls} />
    case "write_file":
      return <FilePlus className={cls} />
    case "search":
      return <Search className={cls} />
    case "terminal":
      return <Terminal className={cls} />
    case "pr_ready":
      return <GitPullRequest className={cls} />
  }
}

function toolCallDescription(tc: ToolCall): string {
  switch (tc.type) {
    case "read_file":
      return tc.file ? `Read ${tc.file}` : tc.summary
    case "edit_file":
      return tc.file ? `Edited ${tc.file}` : tc.summary
    case "write_file":
      return tc.file ? `Created ${tc.file}` : tc.summary
    case "search":
      return tc.summary
    case "terminal":
      return tc.summary
    case "pr_ready":
      return tc.summary
  }
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="relative my-1.5 ml-2">
      {/* Vertical connecting line */}
      <div className="absolute left-[5.5px] top-2 bottom-2 w-px bg-border" />

      <div className="flex flex-col">
        {toolCalls.map((tc) => (
          <div key={tc.id} className="relative flex items-center gap-2.5 py-[5px]">
            <div className="relative z-10 flex h-[12px] w-[12px] shrink-0 items-center justify-center text-muted-foreground">
              <ToolCallIcon type={tc.type} />
            </div>
            <span className="text-xs text-muted-foreground">
              {toolCallDescription(tc)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PRBanner({ prLink }: { prLink: string }) {
  return (
    <a
      href={prLink}
      target="_blank"
      rel="noopener noreferrer"
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 transition-colors hover:bg-primary/15"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
        <GitPullRequest className="h-4 w-4 text-primary" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">Pull request ready</span>
        <span className="truncate text-xs text-muted-foreground">{prLink.replace("https://github.com/", "")}</span>
      </div>
      <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  )
}

function MessageBubble({ message, agent }: { message: Message; agent: Agent }) {
  const isUser = message.role === "user"

  return (
    <div className="flex flex-col">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1">
        {!isUser && (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/20">
            <Terminal className="h-3 w-3 text-primary" />
          </div>
        )}
        <span className={cn(
          "text-[11px] font-medium",
          isUser ? "text-muted-foreground" : "text-foreground"
        )}>
          {isUser ? "You" : agentLabels[agent]}
        </span>
        <span className="text-[10px] text-muted-foreground/40">{message.timestamp}</span>
      </div>

      {/* Message content */}
      <div
        className={cn(
          "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary/15 text-foreground"
            : "bg-secondary/60 text-foreground"
        )}
      >
        {message.content}
      </div>

      {/* Tool calls timeline */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallTimeline toolCalls={message.toolCalls} />
      )}

      {/* PR link */}
      {message.prLink && (
        <div className="mt-2">
          <PRBanner prLink={message.prLink} />
        </div>
      )}
    </div>
  )
}

function AgentPicker({
  agent,
  onSelect,
}: {
  agent: Agent
  onSelect: (a: Agent) => void
}) {
  const [open, setOpen] = useState(false)
  const agents: Agent[] = ["claude-code", "codex", "opencode"]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {agentLabels[agent]}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 flex flex-col rounded-lg border border-border bg-popover py-1 shadow-lg">
          {agents.map((a) => (
            <button
              key={a}
              onClick={() => {
                onSelect(a)
                setOpen(false)
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs transition-colors hover:bg-accent",
                a === agent ? "text-primary" : "text-foreground"
              )}
            >
              {a === agent && <ArrowRight className="h-3 w-3" />}
              {a !== agent && <span className="w-3" />}
              {agentLabels[a]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const headerActions = [
  { icon: GitPullRequest, label: "Create PR" },
  { icon: GitMerge, label: "Merge" },
  { icon: GitCompareArrows, label: "Rebase" },
  { icon: RotateCcw, label: "Reset" },
  { icon: GitFork, label: "Fork" },
  { icon: Tag, label: "Tag" },
  { icon: Diff, label: "Diff" },
  { icon: History, label: "Log" },
]

interface ChatPanelProps {
  branch: Branch
  repoFullName: string
  onBack?: () => void
}

export function ChatPanel({ branch, repoFullName, onBack }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [agent, setAgent] = useState<Agent>(branch.agent)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [branch.messages])

  useEffect(() => {
    setAgent(branch.agent)
  }, [branch.agent])

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          {onBack && (
            <button
              onClick={onBack}
              className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
            </button>
          )}
          <div className="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1 font-mono text-xs text-foreground min-w-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
              <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
            </svg>
            <span className="truncate">{branch.name}</span>
          </div>

          <div className="ml-auto flex items-center gap-0.5 shrink-0 overflow-x-auto">
            {headerActions.map((action) => (
              <Tooltip key={action.label}>
                <TooltipTrigger asChild>
                  <button className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <action.icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">{action.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-6 sm:px-6">
          {branch.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <Terminal className="h-5 w-5" />
              </div>
              <p className="text-sm">Start a conversation to run an agent on this branch</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {branch.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} agent={branch.agent} />
              ))}
              {branch.status === "running" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  Agent is working...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border px-3 py-3 sm:px-6">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe what you want the agent to do..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <button
              className={cn(
                "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                input.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {branch.status === "running" ? (
                <span className="block h-3 w-3 rounded-sm bg-current" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="mt-1.5 flex items-center">
            <AgentPicker agent={agent} onSelect={setAgent} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

export function EmptyChatPanel() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <Terminal className="h-7 w-7" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">Select a branch to start</p>
        <p className="text-xs text-muted-foreground">Choose a repository and branch from the sidebar</p>
      </div>
    </div>
  )
}
