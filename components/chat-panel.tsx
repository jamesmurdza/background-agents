"use client"

import { cn } from "@/lib/utils"
import type { Branch, Message, ToolCall, ContentBlock } from "@/lib/types"
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
  Play,
  Pause,
} from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
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

// Render a text block with markdown
function TextBlockContent({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >{text}</Markdown>
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
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex px-2 cursor-pointer items-center justify-center bg-background text-muted-foreground hover:text-primary transition-colors"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Check if we have interleaved content blocks
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0

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

      {/* Render interleaved content blocks if available */}
      {hasContentBlocks ? (
        <div className="flex flex-col gap-1">
          {message.contentBlocks!.map((block, idx) => {
            if (block.type === "text") {
              return <TextBlockContent key={idx} text={block.text} />
            } else if (block.type === "tool_calls") {
              // Add IDs to tool calls for rendering
              const toolCallsWithIds = block.toolCalls.map((tc, tcIdx) => ({
                ...tc,
                id: tc.id || `tc-${idx}-${tcIdx}`,
                timestamp: tc.timestamp || "",
              }))
              return <ToolCallTimeline key={idx} toolCalls={toolCallsWithIds} />
            }
            return null
          })}
        </div>
      ) : (
        /* Fallback: render content then tool calls (legacy behavior) */
        <>
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
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >{message.content}</Markdown>
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
        </>
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
  gitHistoryOpen: boolean
  onToggleGitHistory: () => void
  onAddMessage: (message: Message) => Promise<string>
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
  onForceSave: () => void
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
}

export function ChatPanel({
  branch,
  repoFullName,
  repoName,
  repoOwner,
  gitHistoryOpen,
  onToggleGitHistory,
  onAddMessage,
  onUpdateMessage,
  onUpdateBranch,
  onSaveDraftForBranch,
  onForceSave,
  onCommitsDetected,
  onBranchFromCommit,
}: ChatPanelProps) {
  const [input, setInput] = useState(branch.draftPrompt ?? "")
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startingCommitRef = useRef<string | null>(null)
  const prevBranchIdRef = useRef(branch.id)
  const prevBranchNameRef = useRef(branch.name)
  const isNearBottomRef = useRef(true)
  // Track current input in a ref so we can access it in cleanup/event handlers
  const inputRef = useRef(input)
  inputRef.current = input
  // Track polling state for background execution
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const currentExecutionIdRef = useRef<string | null>(null)
  const currentMessageIdRef = useRef<string | null>(null)

  // Sync input when switching branches - save old draft then load new
  useEffect(() => {
    if (prevBranchIdRef.current !== branch.id) {
      const prevBranchId = prevBranchIdRef.current
      const prevBranchName = prevBranchNameRef.current
      const currentInput = inputRef.current

      // Check if this is a real branch switch (different branch name) or just an ID update
      // (e.g., client-side ID replaced with server-side ID after sandbox creation)
      const isRealBranchSwitch = prevBranchName !== branch.name

      // Save draft for previous branch (if it has unsaved changes and switching to different branch)
      // This updates both the database AND local state via onSaveDraftForBranch
      if (currentInput && isRealBranchSwitch) {
        if (onSaveDraftForBranch) {
          // Update local state and persist to database
          onSaveDraftForBranch(prevBranchId, currentInput)
        } else {
          // Fallback: just persist to database
          fetch("/api/branches", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: prevBranchId, draftPrompt: currentInput }),
          }).catch(() => {})
        }
      }

      // Only load draft from new branch if it's a real branch switch
      // Keep current input if this is just an ID update (same branch)
      if (isRealBranchSwitch) {
        setInput(branch.draftPrompt ?? "")
        // Reset scroll behavior on branch switch so we scroll to bottom
        isNearBottomRef.current = true
      }

      prevBranchIdRef.current = branch.id
      prevBranchNameRef.current = branch.name
    }
  }, [branch.id, branch.name, branch.draftPrompt, onSaveDraftForBranch])

  // Check sandbox status on mount — detect stopped sandboxes and resume polling for running executions
  useEffect(() => {
    if (!branch.sandboxId) return

    // Skip if we're already polling
    if (pollingRef.current) return

    fetch("/api/sandbox/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sandboxId: branch.sandboxId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.state && data.state !== "started") {
          // Sandbox is stopped
          onUpdateBranch({ status: "stopped" })
        } else if (branch.status === "running" && !pollingRef.current) {
          // Branch shows "running" - check for active execution and resume polling
          // Find the last assistant message that might have a running execution
          const lastAssistantMsg = [...branch.messages].reverse().find(m => m.role === "assistant" && !m.commitHash)
          if (lastAssistantMsg) {
            currentMessageIdRef.current = lastAssistantMsg.id
            startPolling(lastAssistantMsg.id)
          } else {
            // No message to poll for, reset status
            onUpdateBranch({ status: "idle" })
          }
        }
      })
      .catch(() => {})
  }, [branch.id, branch.sandboxId, branch.status, onUpdateBranch])

  // Capture the starting commit hash on mount / branch change
  // This is used to filter out pre-existing commits when detecting new ones
  useEffect(() => {
    if (!branch.sandboxId) return
    // Fetch current HEAD commit as the baseline
    fetch("/api/sandbox/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sandboxId: branch.sandboxId,
        repoPath: `/home/daytona/${repoName}`,
        action: "log",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const commits = data.commits || []
        if (commits.length > 0) {
          // Store the current HEAD commit hash as our starting point
          startingCommitRef.current = commits[0].shortHash
        }
      })
      .catch(() => {})
  }, [branch.id, branch.sandboxId, repoName])

  // Track scroll position to determine if user is near the bottom
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      // Consider "near bottom" if within 150px of the bottom
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150
    }
  }, [])

  // Only auto-scroll to bottom if user is already near the bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
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

  // Save draft on page unload/close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (branch.status === "creating") return
      const currentInput = inputRef.current
      if (currentInput && currentInput !== (branch.draftPrompt ?? "")) {
        // Use sendBeacon for reliable delivery during page unload (POST-only endpoint)
        navigator.sendBeacon(
          "/api/branches/draft",
          new Blob(
            [JSON.stringify({ branchId: branch.id, draftPrompt: currentInput })],
            { type: "application/json" }
          )
        )
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [branch.id, branch.draftPrompt, branch.status])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Start polling for execution status
  const startPolling = useCallback((messageId: string, executionId?: string) => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/agent/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId,
            executionId,
          }),
        })
        const data = await res.json()

        if (!res.ok) {
          console.error("Polling error:", data.error)
          return
        }

        // Update message content
        if (data.content || (data.toolCalls && data.toolCalls.length > 0) || (data.contentBlocks && data.contentBlocks.length > 0)) {
          const toolCallsWithIds = (data.toolCalls || []).map((tc: { tool: string; summary: string }, idx: number) => ({
            id: `tc-${idx}`,
            tool: tc.tool,
            summary: tc.summary,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }))
          // Process contentBlocks with IDs for tool calls
          const contentBlocksWithIds = (data.contentBlocks || []).map((block: { type: string; text?: string; toolCalls?: Array<{ tool: string; summary: string }> }, blockIdx: number) => {
            if (block.type === "tool_calls" && block.toolCalls) {
              return {
                type: "tool_calls" as const,
                toolCalls: block.toolCalls.map((tc, tcIdx) => ({
                  id: `tc-${blockIdx}-${tcIdx}`,
                  tool: tc.tool,
                  summary: tc.summary,
                  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                })),
              }
            }
            return block
          })
          onUpdateMessage(messageId, {
            content: data.content || "",
            toolCalls: toolCallsWithIds,
            contentBlocks: contentBlocksWithIds.length > 0 ? contentBlocksWithIds : undefined,
          })
        }

        // Update session ID if provided
        if (data.sessionId) {
          onUpdateBranch({ sessionId: data.sessionId })
        }

        // Check if completed or error
        if (data.status === "completed" || data.status === "error") {
          // Stop polling
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
          currentExecutionIdRef.current = null
          currentMessageIdRef.current = null

          // Add error to content if present
          if (data.status === "error" && data.error) {
            onUpdateMessage(messageId, {
              content: data.content ? `${data.content}\n\nError: ${data.error}` : `Error: ${data.error}`,
            })
          }

          // Update branch status
          onUpdateBranch({ status: "idle", lastActivity: "now", lastActivityTs: Date.now() })
          onForceSave()

          // Check for new commits
          if (branch.sandboxId) {
            try {
              await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: branch.sandboxId,
                  repoPath: `/home/daytona/${repoName}`,
                  action: "auto-commit-push",
                  branchName: branch.name,
                }),
              })

              const logRes = await fetch("/api/sandbox/git", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sandboxId: branch.sandboxId,
                  repoPath: `/home/daytona/${repoName}`,
                  action: "log",
                }),
              })
              const logData = await logRes.json()
              const allCommits: { shortHash: string; message: string }[] = logData.commits || []

              // Only consider commits that are newer than our starting point
              // git log returns commits newest-first, so we take commits until we hit the starting commit
              const chatCommits = new Set(branch.messages.filter((m) => m.commitHash).map((m) => m.commitHash))
              const newCommits: { shortHash: string; message: string }[] = []
              for (const c of allCommits) {
                // Stop when we reach the starting commit (everything after this existed before the session)
                if (c.shortHash === startingCommitRef.current) break
                // Skip commits already shown in the chat
                if (!chatCommits.has(c.shortHash)) {
                  newCommits.push(c)
                }
              }

              // Add new commits to the chat (reverse to show oldest first)
              for (const c of [...newCommits].reverse()) {
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
                // Update the starting commit to the new HEAD so future detections work correctly
                if (allCommits.length > 0) {
                  startingCommitRef.current = allCommits[0].shortHash
                }
                onCommitsDetected?.()
              }
            } catch {}
          }

          // Play notification sound
          try {
            const ctx = new AudioContext()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = 880
            osc.type = "sine"
            gain.gain.setValueAtTime(0.15, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.3)
          } catch {}
        }
      } catch (err) {
        console.error("Polling failed:", err)
      }
    }

    // Start polling immediately, then every 500ms
    poll()
    pollingRef.current = setInterval(poll, 500)
  }, [branch.sandboxId, branch.name, branch.messages, repoName, onUpdateMessage, onUpdateBranch, onAddMessage, onForceSave, onCommitsDetected])

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || branch.status === "running" || branch.status === "creating") return
    if (!branch.sandboxId) return

    // Add user message
    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    // Await user message save to ensure it persists before continuing
    await onAddMessage(userMsg)
    setInput("")

    // Set branch to running and clear draft
    onUpdateBranch({ status: "running", draftPrompt: "" })

    // Add placeholder assistant message and get its DB ID
    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(assistantMsg)
    currentMessageIdRef.current = messageId

    try {
      // Start background execution
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          prompt,
          previewUrlPattern: branch.previewUrlPattern,
          repoName,
          messageId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to start agent")
      }

      const { executionId } = await response.json()
      currentExecutionIdRef.current = executionId

      // Start polling for updates
      startPolling(messageId, executionId)

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(messageId, { content: `Error: ${message}` })
      onUpdateBranch({ status: "idle" })
      currentMessageIdRef.current = null
      currentExecutionIdRef.current = null
    }
  }, [input, branch, repoName, onAddMessage, onUpdateMessage, onUpdateBranch, startPolling])

  function handleStop() {
    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    // Update message with stopped indicator
    if (currentMessageIdRef.current) {
      // Get current content and append stopped message
      const lastMsg = branch.messages.find(m => m.id === currentMessageIdRef.current)
      const currentContent = lastMsg?.content || ""
      onUpdateMessage(currentMessageIdRef.current, {
        content: currentContent ? `${currentContent}\n\n[Stopped by user]` : "[Stopped by user]"
      })
    }

    // Reset state
    currentExecutionIdRef.current = null
    currentMessageIdRef.current = null
    onUpdateBranch({ status: "idle" })

    // Legacy: also abort any SSE connection
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
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "rename-branch",
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
      const res = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`
      )
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

  const [sandboxToggleLoading, setSandboxToggleLoading] = useState(false)

  async function handleSandboxToggle() {
    if (!branch.sandboxId || sandboxToggleLoading) return
    const isStopped = branch.status === "stopped"
    setSandboxToggleLoading(true)
    try {
      const res = await fetch("/api/sandbox/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          action: isStopped ? "start" : "stop",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch({ status: isStopped ? "idle" : "stopped" })
    } catch {
      // ignore
    } finally {
      setSandboxToggleLoading(false)
    }
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
    const [owner, repo] = repoFullName.split("/")
    setActionLoading("create-pr")
    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "merge",
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
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "rebase",
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
    const [owner, repo] = repoFullName.split("/")
    setTagPopoverOpen(false)
    setTagNameInput("")
    setActionLoading("tag")
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "tag",
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

  const canSend = input.trim() && branch.status !== "running" && branch.status !== "creating" && branch.sandboxId
  const isReady = branch.sandboxId && (branch.status !== "creating")
  const isBusy = branch.status === "running" || branch.status === "creating"

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
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
                  <button
                    onClick={handleSandboxToggle}
                    disabled={sandboxToggleLoading || branch.status === "running" || branch.status === "creating"}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {sandboxToggleLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : branch.status === "stopped" ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {branch.status === "stopped" ? "Start sandbox" : "Pause sandbox"}
                </TooltipContent>
              </Tooltip>
              <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
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
                          const safeBranch = branch.name.replace(/[^a-zA-Z0-9._-]/g, "-")
                          const localDir = `./${owner}-${repo}-${safeBranch}`
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
                      disabled={!isReady || (isBusy && action.action !== "log" && action.action !== "diff") || isPRLoading}
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
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-6 sm:px-6">
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
                  ? "Type your first message while the sandbox is being set up..."
                  : !branch.sandboxId
                  ? "Sandbox not available"
                  : branch.status === "stopped"
                  ? "Sandbox paused \u2014 will resume on send..."
                  : "Describe what you want the agent to do..."
              }
              rows={1}
              disabled={!isReady && branch.status !== "creating"}
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
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
        />
      )}

      {/* Diff modal — single commit */}
      {branch.sandboxId && (
        <DiffModal
          open={!!commitDiffHash}
          onClose={() => { setCommitDiffHash(null); setCommitDiffMessage(null) }}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
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
