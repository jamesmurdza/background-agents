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
  Tag,
  RotateCcw,
  History,
  Diff,
  FolderSearch,
  Regex,
  AlertCircle,
  GitCommitHorizontal,
  GitBranch,
  Copy,
  Check,
  FolderSync,
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
    <div className="relative my-1.5 ml-[10px]">
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

function MessageBubble({ message, onCommitClick, onBranchFromCommit }: { message: Message; onCommitClick?: (hash: string, msg: string) => void; onBranchFromCommit?: (hash: string) => void }) {
  const isUser = message.role === "user"

  // Commit marker rendering
  if (message.commitHash) {
    return (
      <div id={`commit-${message.commitHash}`} className="group/commitrow flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <button
          onClick={() => onCommitClick?.(message.commitHash!, message.commitMessage || "")}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:border-primary/30 transition-colors"
        >
          <GitCommitHorizontal className="h-3 w-3" />
          <code className="font-mono text-[10px] text-primary/70">{message.commitHash}</code>
          <span className="max-w-[200px] truncate">{message.commitMessage}</span>
        </button>
        <div className="relative h-px flex-1 bg-border">
          {onBranchFromCommit && (
            <button
              onClick={(e) => { e.stopPropagation(); onBranchFromCommit(message.commitHash!) }}
              title="Branch from here"
              className="absolute right-0 top-1/2 -translate-y-1/2 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 group-hover/commitrow:opacity-100 hover:text-primary hover:border-primary/30 transition-all"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

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
            : "bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0"
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
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
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
  onCommitsDetected,
  onBranchFromCommit,
  onBack,
}: ChatPanelProps) {
  const [input, setInput] = useState("")
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const knownCommitsRef = useRef<Set<string>>(new Set())

  // Populate baseline known commits on mount / branch change
  useEffect(() => {
    if (!branch.sandboxId) return
    knownCommitsRef.current = new Set()
    fetch("/api/sandbox/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        daytonaApiKey: settings.daytonaApiKey,
        sandboxId: branch.sandboxId,
        repoPath: `/home/daytona/${repoName}`,
        action: "log",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const commits = data.commits || []
        knownCommitsRef.current = new Set(commits.map((c: { shortHash: string }) => c.shortHash))
      })
      .catch(() => {})
  }, [branch.id, branch.sandboxId, settings.daytonaApiKey, repoName])

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
    let hadToolCalls = false

    function startNewBubble() {
      content = ""
      toolCalls = []
      hadToolCalls = false
      const newMsg: Message = {
        id: generateId(),
        role: "assistant",
        content: "",
        toolCalls: [],
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }
      onAddMessage(newMsg)
    }

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
                if (text.startsWith("TOOL_USE:")) {
                  const toolSummary = text.replace("TOOL_USE:", "").trim()
                  const toolName = toolSummary.split(":")[0].trim()
                  toolCalls = [
                    ...toolCalls,
                    {
                      id: generateId(),
                      tool: toolName,
                      summary: toolSummary,
                      timestamp: new Date().toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    },
                  ]
                  hadToolCalls = true
                } else {
                  // If text arrives after tool calls, start a new bubble
                  if (hadToolCalls && text.trim()) {
                    startNewBubble()
                  }
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

        // Detect new commits and insert inline markers
        try {
          const logRes = await fetch("/api/sandbox/git", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              daytonaApiKey: settings.daytonaApiKey,
              sandboxId: branch.sandboxId,
              repoPath: `/home/daytona/${repoName}`,
              action: "log",
            }),
          })
          const logData = await logRes.json()
          const allCommits: { shortHash: string; message: string }[] = logData.commits || []
          const newCommits = allCommits.filter((c) => !knownCommitsRef.current.has(c.shortHash))
          // Insert oldest-first so they appear chronologically
          for (const c of [...newCommits].reverse()) {
            knownCommitsRef.current.add(c.shortHash)
            onAddMessage({
              id: generateId(),
              role: "assistant",
              content: "",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              commitHash: c.shortHash,
              commitMessage: c.message,
            })
          }
          if (newCommits.length > 0) {
            onCommitsDetected?.()
          }
        } catch {}
      }
      onUpdateBranch({ status: "idle", lastActivity: "now", lastActivityTs: Date.now() })
      abortControllerRef.current = null
      onForceSave()
    }
  }, [input, branch, settings, repoName, onAddMessage, onUpdateLastMessage, onUpdateBranch, onForceSave, onCommitsDetected])

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleRename() {
    const newName = renameValue.trim()
    if (!newName || newName === branch.name || renameLoading) return
    setRenameLoading(true)
    try {
      const [owner, repo] = repoFullName.split("/")
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "rename-branch",
          githubPat: settings.githubPat,
          currentBranch: branch.name,
          newBranchName: newName,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch({ name: newName })
      setRenaming(false)
    } catch (err: unknown) {
      addSystemMessage(`Rename failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setRenaming(false)
    } finally {
      setRenameLoading(false)
    }
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
          githubPat: settings.githubPat,
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
  const [commitDiffHash, setCommitDiffHash] = useState<string | null>(null)
  const [commitDiffMessage, setCommitDiffMessage] = useState<string | null>(null)

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [tagNameInput, setTagNameInput] = useState("")
  const [rsyncModalOpen, setRsyncModalOpen] = useState(false)
  const [rsyncCommand, setRsyncCommand] = useState("")
  const [rsyncCopied, setRsyncCopied] = useState(false)

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
          {renaming ? (
            <div className="flex items-center gap-1.5 min-w-0 ml-2.5">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
              </svg>
              <div className="inline-grid min-w-0 [&>*]:[grid-area:1/1]">
                <span className="invisible whitespace-pre px-1.5 text-xs font-mono">{renameValue || " "}</span>
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename()
                    if (e.key === "Escape") setRenaming(false)
                  }}
                  onBlur={() => { if (!renameLoading) setRenaming(false) }}
                  disabled={renameLoading}
                  className="h-6 bg-transparent border border-border/30 rounded px-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-border/60 min-w-[3ch]"
                  autoFocus
                />
              </div>
              {renameLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
            </div>
          ) : (
            <button
              onClick={() => { setRenaming(true); setRenameValue(branch.name) }}
              className="flex items-center gap-1.5 min-w-0 ml-2.5 py-1 cursor-pointer group/branch"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
              </svg>
              <span className="truncate text-xs font-mono text-muted-foreground">{branch.name}</span>
              <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground/0 group-hover/branch:text-muted-foreground transition-colors" />
            </button>
          )}

          <div className="ml-auto flex items-center gap-0.5 shrink-0 overflow-x-auto">
            {branch.sandboxId && (<>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={`https://github.com/${repoFullName}/tree/${branch.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Open on GitHub</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/sandbox/ssh", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            daytonaApiKey: settings.daytonaApiKey,
                            sandboxId: branch.sandboxId,
                          }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        const cmd = data.sshCommand as string
                        const userHostMatch = cmd.match(/(\S+@\S+)/)
                        const portMatch = cmd.match(/-p\s+(\d+)/)
                        if (userHostMatch) {
                          const userHost = userHostMatch[1]
                          const port = portMatch ? portMatch[1] : "22"
                          const host = port !== "22" ? `${userHost}:${port}` : userHost
                          const remotePath = `/home/daytona/${repoName}`
                          window.open(`vscode://vscode-remote/ssh-remote+${host}${remotePath}`, "_blank")
                        }
                      } catch {}
                    }}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
                      <path d="M70.9 97.8l25.3-12.2c2.3-1.1 3.8-3.5 3.8-6.1V20.5c0-2.6-1.5-5-3.8-6.1L70.9 2.2c-2.9-1.4-6.3-.9-8.6 1.2L26.2 37.7 10.8 26.1c-1.9-1.5-4.6-1.3-6.3.3l-3.2 2.9c-1.9 1.7-1.9 4.7 0 6.5L14.9 50 1.3 64.3c-1.9 1.7-1.9 4.7 0 6.5l3.2 2.9c1.7 1.6 4.4 1.8 6.3.3l15.4-11.6 36.1 34.3c1.5 1.4 3.5 2.1 5.5 2.1.3 0 2.1-.5 3.1-1zM71 27.5L40.4 50 71 72.5V27.5z" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Open in VS Code</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/sandbox/ssh", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            daytonaApiKey: settings.daytonaApiKey,
                            sandboxId: branch.sandboxId,
                          }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        const cmd = data.sshCommand as string
                        const userHostMatch = cmd.match(/(\S+@\S+)/)
                        const portMatch = cmd.match(/-p\s+(\d+)/)
                        if (userHostMatch) {
                          const userHost = userHostMatch[1]
                          const port = portMatch ? portMatch[1] : "22"
                          const [owner, repo] = repoFullName.split("/")
                          const localDir = `./${owner}-${repo}-${branch.name}`
                          const rsyncCmd = `mkdir -p ${localDir} && \\\nwhile true; do \\\n  rsync -avz --filter=':- .gitignore' -e 'ssh -p ${port}' \\\n    ${userHost}:/home/daytona/${repoName}/ \\\n    ${localDir}/; \\\n  sleep 2; \\\ndone`
                          setRsyncCommand(rsyncCmd)
                          setRsyncCopied(false)
                          setRsyncModalOpen(true)
                        }
                      } catch {}
                    }}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <FolderSync className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Sync to local</TooltipContent>
              </Tooltip>
              <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
            </>)}
            {headerActions.map((action) => {
              const isActive = action.action === "log" && gitHistoryOpen
              const hasPR = action.action === "create-pr" && !!branch.prUrl
              const isPRLoading = action.action === "create-pr" && actionLoading === "create-pr"
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleHeaderAction(action.action)}
                      disabled={!isReady || (isBusy && action.action !== "log") || isPRLoading}
                      className={cn(
                        "flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                        hasPR
                          ? "text-green-400"
                          : isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {isPRLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <action.icon className="h-3.5 w-3.5" />
                      )}
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
                <MessageBubble key={msg.id} message={msg} onCommitClick={(hash, msg) => { setCommitDiffHash(hash); setCommitDiffMessage(msg) }} onBranchFromCommit={onBranchFromCommit} />
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

      {/* Rsync command modal */}
      <Dialog open={rsyncModalOpen} onOpenChange={(open) => { setRsyncModalOpen(open); if (!open) setRsyncCopied(false) }}>
        <DialogContent className="sm:max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm">Sync to local</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Run this in your terminal to continuously sync the sandbox to a local folder. It respects <code className="rounded bg-muted px-1 py-0.5">.gitignore</code> files and re-syncs every 2 seconds. Press <code className="rounded bg-muted px-1 py-0.5">Ctrl+C</code> to stop.
          </p>
          <div className="relative">
            <pre className="rounded-md bg-muted p-3 pr-9 text-xs font-mono whitespace-pre-wrap break-all">{rsyncCommand}</pre>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(rsyncCommand)
                setRsyncCopied(true)
                setTimeout(() => setRsyncCopied(false), 2000)
              }}
              className="absolute top-2 right-2 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {rsyncCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diff modal — branch comparison */}
      {branch.sandboxId && (
        <DiffModal
          open={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          sandboxId={branch.sandboxId}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          settings={settings}
        />
      )}

      {/* Diff modal — single commit */}
      {branch.sandboxId && (
        <DiffModal
          open={!!commitDiffHash}
          onClose={() => { setCommitDiffHash(null); setCommitDiffMessage(null) }}
          sandboxId={branch.sandboxId}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          settings={settings}
          commitHash={commitDiffHash}
          commitMessage={commitDiffMessage}
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
