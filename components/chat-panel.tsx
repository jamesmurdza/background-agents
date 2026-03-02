"use client"

import { cn } from "@/lib/utils"
import type { Branch, Message, ToolCall, Settings } from "@/lib/types"
import { agentLabels } from "@/lib/types"
import { generateId } from "@/lib/store"
import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  Terminal,
  GitPullRequest,
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
  FolderSearch,
  Regex,
  AlertCircle,
} from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import Markdown from "react-markdown"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DiffModal } from "@/components/diff-modal"

function ToolCallIcon({ tool }: { tool: string }) {
  const cls = "h-3 w-3"
  switch (tool) {
    case "Read":
      return <FileText className={cls} />
    case "Edit":
      return <Pencil className={cls} />
    case "Write":
      return <FilePlus className={cls} />
    case "Glob":
      return <FolderSearch className={cls} />
    case "Grep":
      return <Regex className={cls} />
    case "Bash":
      return <Terminal className={cls} />
    case "Search":
      return <Search className={cls} />
    default:
      return <Terminal className={cls} />
  }
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="relative my-1.5 ml-2">
      <div className="absolute left-[5.5px] top-2 bottom-2 w-px bg-border" />
      <div className="flex flex-col">
        {toolCalls.map((tc) => (
          <div key={tc.id} className="relative flex items-center gap-2.5 py-[5px]">
            <div className="relative z-10 flex h-[12px] w-[12px] shrink-0 items-center justify-center text-muted-foreground">
              <ToolCallIcon tool={tc.tool} />
            </div>
            <span className="text-xs text-muted-foreground">
              {tc.summary}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"

  return (
    <div className="flex flex-col">
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
          {isUser ? "You" : "Claude Code"}
        </span>
        <span className="text-[10px] text-muted-foreground/40">{message.timestamp}</span>
      </div>

      <div
        className={cn(
          "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary/15 text-foreground whitespace-pre-wrap"
            : "bg-secondary/60 text-foreground prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0"
        )}
      >
        {message.content ? (
          isUser ? (
            message.content
          ) : (
            <Markdown>{message.content}</Markdown>
          )
        ) : (
          message.role === "assistant" && (
            <span className="text-muted-foreground/50 italic">Thinking...</span>
          )
        )}
      </div>

      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallTimeline toolCalls={message.toolCalls} />
      )}
    </div>
  )
}

const headerActions = [
  { icon: GitPullRequest, label: "Create PR", action: "create-pr" },
  { icon: GitMerge, label: "Merge", action: "merge" },
  { icon: GitCompareArrows, label: "Rebase", action: "rebase" },
  { icon: RotateCcw, label: "Reset", action: "reset" },
  { icon: GitFork, label: "Fork", action: "fork" },
  { icon: Tag, label: "Tag", action: "tag" },
  { icon: Diff, label: "Diff", action: "diff" },
  { icon: History, label: "Log", action: "log" },
]

interface ChatPanelProps {
  branch: Branch
  repoFullName: string
  repoName: string
  repoOwner: string
  settings: Settings
  gitHistoryOpen: boolean
  onToggleGitHistory: () => void
  onAddMessage: (message: Message) => void
  onUpdateLastMessage: (updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onForceSave: () => void
  onForkRepo?: (repo: { name: string; owner: string; avatar: string; defaultBranch: string }) => void
  onBack?: () => void
}

export function ChatPanel({
  branch,
  repoFullName,
  repoName,
  repoOwner,
  settings,
  gitHistoryOpen,
  onToggleGitHistory,
  onAddMessage,
  onUpdateLastMessage,
  onUpdateBranch,
  onForceSave,
  onForkRepo,
  onBack,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [branch.messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px"
    }
  }, [input])

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || branch.status === "running" || branch.status === "creating") return
    if (!branch.sandboxId || !branch.contextId) return

    if (!settings.daytonaApiKey) {
      onAddMessage({
        id: generateId(),
        role: "assistant",
        content: "Please configure your Daytona API key in Settings.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })
      return
    }

    // Add user message
    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    onAddMessage(userMsg)
    setInput("")

    // Set branch to running
    onUpdateBranch({ status: "running" })

    // Add placeholder assistant message
    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    onAddMessage(assistantMsg)

    // Stream the response
    const controller = new AbortController()
    abortControllerRef.current = controller
    let content = ""
    let toolCalls: ToolCall[] = []

    try {
      const response = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          contextId: branch.contextId,
          prompt,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Request failed")
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop()!

        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === "stdout" || data.type === "stderr") {
                const text = data.content as string
                // Check for tool use indicator
                if (text.startsWith("TOOL_USE:")) {
                  const toolName = text.replace("TOOL_USE:", "").trim()
                  toolCalls = [
                    ...toolCalls,
                    {
                      id: generateId(),
                      tool: toolName,
                      summary: toolName,
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    },
                  ]
                } else {
                  content += text
                }
                onUpdateLastMessage({ content, toolCalls })
              } else if (data.type === "error") {
                content += content ? `\n\nError: ${data.message}` : `Error: ${data.message}`
                onUpdateLastMessage({ content })
              }
            } catch {}
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        content += content ? "\n\n[Stopped by user]" : "[Stopped by user]"
        onUpdateLastMessage({ content })
      } else {
        const message = err instanceof Error ? err.message : "Unknown error"
        content += content ? `\n\nError: ${message}` : `Error: ${message}`
        onUpdateLastMessage({ content })
      }
    } finally {
      // Auto-commit and push any remaining changes
      if (branch.sandboxId && settings.githubPat) {
        try {
          await fetch("/api/sandbox/git", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              daytonaApiKey: settings.daytonaApiKey,
              sandboxId: branch.sandboxId,
              repoPath: `/home/daytona/${repoName}`,
              action: "auto-commit-push",
              githubPat: settings.githubPat,
            }),
          })
        } catch {}
      }
      onUpdateBranch({ status: "idle", lastActivity: "now" })
      abortControllerRef.current = null
      onForceSave()
    }
  }, [input, branch, settings, repoName, onAddMessage, onUpdateLastMessage, onUpdateBranch, onForceSave])

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [branchPickerModal, setBranchPickerModal] = useState<{ action: "merge" | "rebase" | "diff" } | null>(null)
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)

  async function fetchBranches() {
    setBranchesLoading(true)
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "list-branches",
        }),
      })
      const data = await res.json()
      const branches = (data.branches || []).filter((b: string) => b !== branch.name)
      setRemoteBranches(branches)
      setSelectedBranch(branches.includes(branch.baseBranch) ? branch.baseBranch : branches[0] || "")
    } catch {
      setRemoteBranches([])
    } finally {
      setBranchesLoading(false)
    }
  }

  function openBranchPicker(action: "merge" | "rebase" | "diff") {
    setBranchPickerModal({ action })
    setSelectedBranch("")
    fetchBranches()
  }

  function addSystemMessage(content: string) {
    onAddMessage({
      id: generateId(),
      role: "assistant",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    })
  }

  async function handleCreatePR() {
    // If PR already exists, just open it
    if (branch.prUrl) {
      window.open(branch.prUrl, "_blank")
      return
    }
    if (!settings.githubPat) return
    const [owner, repo] = repoFullName.split("/")
    setActionLoading("create-pr")
    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: settings.githubPat,
          owner,
          repo,
          head: branch.name,
          base: branch.baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch({ prUrl: data.url })
      window.open(data.url, "_blank")
    } catch {
      // Silently fail
    } finally {
      setActionLoading(null)
    }
  }

  async function handleMerge() {
    if (!selectedBranch) return
    setBranchPickerModal(null)
    setActionLoading("merge")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "merge",
          githubPat: settings.githubPat,
          targetBranch: selectedBranch,
          currentBranch: branch.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Merged **${branch.name}** into **${selectedBranch}** and pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRebase() {
    if (!selectedBranch) return
    const [owner, repo] = repoFullName.split("/")
    setBranchPickerModal(null)
    setActionLoading("rebase")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "rebase",
          githubPat: settings.githubPat,
          targetBranch: selectedBranch,
          currentBranch: branch.name,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Rebased **${branch.name}** onto **${selectedBranch}** and force-pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Rebase failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  async function handleReset() {
    setResetConfirmOpen(false)
    setActionLoading("reset")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "reset",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage("Reset to HEAD — all uncommitted changes discarded.")
    } catch (err: unknown) {
      addSystemMessage(`Reset failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleHeaderAction(action: string) {
    if (action === "log") {
      onToggleGitHistory()
      return
    }
    if (action === "create-pr") {
      handleCreatePR()
      return
    }
    if (action === "merge") {
      openBranchPicker("merge")
      return
    }
    if (action === "rebase") {
      openBranchPicker("rebase")
      return
    }
    if (action === "reset") {
      setResetConfirmOpen(true)
      return
    }
    if (action === "fork") {
      handleFork()
      return
    }
    if (action === "tag") {
      setTagPopoverOpen(true)
      return
    }
    if (action === "diff") {
      setDiffModalOpen(true)
      return
    }
  }

  const [diffModalOpen, setDiffModalOpen] = useState(false)

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [tagNameInput, setTagNameInput] = useState("")

  async function handleTag() {
    const name = tagNameInput.trim()
    if (!name) return
    if (!settings.githubPat) {
      addSystemMessage("GitHub PAT required to push tags. Configure it in Settings.")
      return
    }
    const [owner, repo] = repoFullName.split("/")
    setTagPopoverOpen(false)
    setTagNameInput("")
    setActionLoading("tag")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "tag",
          githubPat: settings.githubPat,
          tagName: name,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Tag **${name}** created and pushed.`)
    } catch (err: unknown) {
      addSystemMessage(`Tag failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleFork() {
    if (!settings.githubPat) {
      addSystemMessage("GitHub PAT required to fork. Configure it in Settings.")
      return
    }
    const [owner, repo] = repoFullName.split("/")
    setActionLoading("fork")
    try {
      const res = await fetch("/api/github/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: settings.githubPat,
          owner,
          name: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addSystemMessage(`Forked to **${data.owner}/${data.name}**`)
      if (onForkRepo) {
        onForkRepo({
          name: data.name,
          owner: data.owner,
          avatar: data.avatar,
          defaultBranch: data.defaultBranch,
        })
      }
    } catch (err: unknown) {
      addSystemMessage(`Fork failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setActionLoading(null)
    }
  }

  const canSend = input.trim() && branch.status !== "running" && branch.status !== "creating" && branch.sandboxId && branch.contextId
  const isReady = branch.sandboxId && branch.contextId && branch.status !== "creating"
  const isBusy = branch.status === "running" || branch.status === "creating"

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
          <a
            href={`https://github.com/${repoFullName}/tree/${branch.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
              <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
            </svg>
            <span className="truncate">{branch.name}</span>
          </a>

          <div className="ml-auto flex items-center gap-0.5 shrink-0 overflow-x-auto">
            {headerActions.map((action) => {
              const isActive = action.action === "log" && gitHistoryOpen
              const hasPR = action.action === "create-pr" && !!branch.prUrl
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleHeaderAction(action.action)}
                      disabled={!isReady || (isBusy && action.action !== "log")}
                      className={cn(
                        "flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                        hasPR
                          ? "text-green-400 shadow-[0_0_8px_rgba(74,222,128,0.4)]"
                          : isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <action.icon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {hasPR ? "Open PR" : action.label}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-6 sm:px-6">
          {branch.status === "creating" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Setting up sandbox...</p>
              <p className="text-xs text-muted-foreground/60">
                Cloning repo, installing agent SDK...
              </p>
            </div>
          ) : branch.status === "error" && !branch.sandboxId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-400">Failed to create sandbox</p>
              <p className="text-xs text-muted-foreground/60">
                Check your API keys in Settings and try again
              </p>
            </div>
          ) : branch.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <Terminal className="h-5 w-5" />
              </div>
              <p className="text-sm">Start a conversation with Claude Code</p>
              <p className="text-xs text-muted-foreground/60">
                The agent has access to Read, Edit, Write, Bash and more
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {branch.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
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
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                branch.status === "creating"
                  ? "Waiting for sandbox..."
                  : !branch.sandboxId
                  ? "Sandbox not available"
                  : "Describe what you want the agent to do..."
              }
              rows={1}
              disabled={!isReady}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={branch.status === "running" ? handleStop : handleSend}
              disabled={branch.status === "running" ? false : !canSend}
              className={cn(
                "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                branch.status === "running"
                  ? "bg-red-500/80 text-white hover:bg-red-500"
                  : canSend
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
            <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <Terminal className="h-3 w-3" />
              Claude Code
            </span>
          </div>
        </div>
      </div>

      {/* Branch picker modal (merge/rebase) */}
      <Dialog open={!!branchPickerModal} onOpenChange={(open) => !open && setBranchPickerModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {branchPickerModal?.action === "merge" && `Merge ${branch.name} into...`}
              {branchPickerModal?.action === "rebase" && `Rebase ${branch.name} onto...`}
            </DialogTitle>
          </DialogHeader>
          {branchesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : remoteBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
          ) : (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {remoteBranches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <button
              onClick={() => setBranchPickerModal(null)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (branchPickerModal?.action === "merge") handleMerge()
                if (branchPickerModal?.action === "rebase") handleRebase()
              }}
              disabled={!selectedBranch || actionLoading !== null}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {branchPickerModal?.action === "merge" ? "Merge" : "Rebase"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation dialog */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Reset to HEAD?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            This will discard all uncommitted changes. This cannot be undone.
          </p>
          <DialogFooter>
            <button
              onClick={() => setResetConfirmOpen(false)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleReset}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Reset
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={tagPopoverOpen} onOpenChange={(open) => { setTagPopoverOpen(open); if (!open) setTagNameInput("") }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Tag</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="v1.0.0"
            value={tagNameInput}
            onChange={(e) => setTagNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleTag() }}
            className="h-8 text-xs font-mono"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => { setTagPopoverOpen(false); setTagNameInput("") }}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleTag}
              disabled={!tagNameInput.trim()}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff modal */}
      {branch.sandboxId && (
        <DiffModal
          open={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          sandboxId={branch.sandboxId}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          settings={settings}
        />
      )}
    </TooltipProvider>
  )
}

export function EmptyChatPanel({ hasRepos }: { hasRepos?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <Terminal className="h-7 w-7" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {hasRepos ? "Select a branch to start" : "Add a repository to get started"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasRepos
            ? "Choose a repository and branch from the sidebar"
            : "Click the + button in the sidebar to add a GitHub repo"}
        </p>
      </div>
    </div>
  )
}
