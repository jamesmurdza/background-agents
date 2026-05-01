"use client"

import { useState, useMemo } from "react"
import { ChevronDown, ChevronRight, Terminal, FileText, Search, GitMerge, LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, ContentBlock, ToolCall, MessageMetadata } from "@/lib/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import hljs from "highlight.js/lib/common"

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  isMobile?: boolean
  repo?: string
  /** Called when the user clicks a tool-call row that references a file. */
  onOpenFile?: (filePath: string) => void
  /** Called when the user clicks the "force push" link in a push-failure message. */
  onForcePush?: () => void
}

export function MessageBubble({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush }: MessageBubbleProps) {
  const isUser = message.role === "user"
  const hasUploadedFiles = isUser && message.uploadedFiles && message.uploadedFiles.length > 0

  return (
    <div
      className={cn("flex", isUser && "justify-end")}
      data-testid={isUser ? "user-message" : "assistant-message"}
      data-message-id={message.id}
      data-role={message.role}
    >
      {/* Content */}
      <div className={cn(
        isUser && "text-right",
        isUser && (isMobile ? "max-w-[95%]" : "max-w-[90%]")
      )}>
        {isUser ? (
          <div>
            <div className={cn(
              "inline-block rounded-lg bg-muted text-foreground",
              isMobile ? "px-3 py-2 text-base" : "px-4 py-2 text-[15px]"
            )}>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
            {/* Uploaded files display */}
            {hasUploadedFiles && (
              <div className={cn(
                "mt-1 space-y-1 text-muted-foreground",
                isMobile ? "text-sm" : "text-[13px]"
              )}>
                {message.uploadedFiles!.map((filePath, index) => {
                  const fileName = filePath.split("/").pop() || filePath
                  return (
                    <div key={index} className="flex items-center gap-1 truncate">
                      <FileText className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "shrink-0")} />
                      {fileName}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <AssistantContent message={message} isStreaming={isStreaming} isMobile={isMobile} repo={repo} onOpenFile={onOpenFile} onForcePush={onForcePush} />
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Assistant Content (with tool calls)
// =============================================================================

function MarkdownContent({ text, isMobile = false }: { text: string; isMobile?: boolean }) {
  return (
    <div className={cn(
      "prose dark:prose-invert max-w-none overflow-hidden",
      // Spacing is controlled via component overrides below; prose-* utilities
      // here only set typography (leading, font-size). This avoids conflicts.
      "prose-p:leading-relaxed",
      "prose-li:leading-relaxed",
      "prose-headings:font-semibold",
      // Remove default prose margins; we apply explicit spacing below
      "prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-pre:my-0 prose-headings:my-0",
      // First/last child margin reset (handles edge cases)
      "[&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0",
      isMobile ? "prose-base" : "prose-sm prose-p:text-[15px] prose-li:text-[15px]"
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary break-words"
            >
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p className="mt-2 first:mt-0 max-w-[95%]">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mt-2 first:mt-0 pl-4 list-disc space-y-0.5 [&_ul]:mt-1 [&_ol]:mt-1 max-w-[95%]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-2 first:mt-0 pl-4 list-decimal space-y-0.5 [&_ul]:mt-1 [&_ol]:mt-1 max-w-[95%]">{children}</ol>
          ),
          li: ({ children }) => (
            <li>{children}</li>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mt-2 first:mt-0 max-w-full">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/50 px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          pre: ({ children }) => (
            <pre className={cn(
              "overflow-x-auto max-w-full rounded-md border border-border/70 p-3 mt-4 mb-2 first:mt-0",
              "bg-white/70 dark:bg-white/[0.03]",
              isMobile && "rounded-lg"
            )}>
              {children}
            </pre>
          ),
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold mt-4 mb-2 first:mt-0 max-w-[95%]">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mt-4 mb-2 first:mt-0 max-w-[95%]">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-3 mb-1.5 first:mt-0 max-w-[95%]">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold mt-3 mb-1 first:mt-0 max-w-[95%]">{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mt-2 first:mt-0 border-l-2 border-border pl-4 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="mt-4 mb-4 first:mt-0 border-t border-border" />
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          code: ({ children, className, ...props }) => {
            // Detect language from className (e.g., "language-typescript")
            const match = /language-(\w+)/.exec(className || "")
            const isBlock = !!match

            if (isBlock) {
              // Extract text content from children
              const code = String(children).replace(/\n$/, "")
              const lang = match[1]

              // Try to highlight with specified language, fall back to auto-detect
              let highlighted: string
              try {
                if (hljs.getLanguage(lang)) {
                  highlighted = hljs.highlight(code, { language: lang }).value
                } else {
                  highlighted = hljs.highlightAuto(code).value
                }
              } catch {
                highlighted = code
              }

              return (
                <code
                  className="hljs-scope text-[13px]"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              )
            }

            // Inline code - styled but no syntax highlighting
            return (
              <code {...props} className="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[0.9em] break-words">
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function AssistantContent({ message, isStreaming, isMobile = false, repo, onOpenFile, onForcePush }: { message: Message; isStreaming?: boolean; isMobile?: boolean; repo?: string; onOpenFile?: (filePath: string) => void; onForcePush?: () => void }) {
  const hasContent = message.content && message.content.trim().length > 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasBlocks = message.contentBlocks && message.contentBlocks.length > 0
  const isEmpty = !hasContent && !hasToolCalls && !hasBlocks
  const isGitOperation = message.messageType === "git-operation"

  if (isEmpty) {
    if (!isStreaming) return null
    return (
      <div className="text-2xl text-muted-foreground animate-pulse">
        ...
      </div>
    )
  }

  // Git operation messages use SystemMessage component
  if (isGitOperation) {
    return (
      <SystemMessage
        icon={GitMerge}
        content={message.content}
        variant={message.isError ? "error" : "success"}
        isMobile={isMobile}
        repo={repo}
        linkBranch={message.linkBranch}
        metadata={message.metadata}
        onForcePush={onForcePush}
      />
    )
  }

  // Merge consecutive tool_calls blocks into single groups (memoized to avoid recalculating on every render)
  const mergedBlocks = useMemo(() => {
    return hasBlocks ? mergeConsecutiveToolCalls(message.contentBlocks!) : null
  }, [hasBlocks, message.contentBlocks])

  return (
    <div className={cn(
      "leading-relaxed",
      isMobile ? "space-y-4 text-base" : "space-y-3 text-[15px]"
    )}>
      {mergedBlocks ? (
        // Render merged content blocks
        mergedBlocks.map((block, index) => {
          if (block.type === "text" && block.text.trim()) {
            return <MarkdownContent key={index} text={block.text} isMobile={isMobile} />
          }
          if (block.type === "tool_calls") {
            return (
              <ToolCallGroup
                key={index}
                toolCalls={block.toolCalls}
                isMobile={isMobile}
                onOpenFile={onOpenFile}
              />
            )
          }
          return null
        })
      ) : (
        // Fallback: render content then tool calls (for messages without contentBlocks)
        <>
          {hasContent && <MarkdownContent text={message.content} isMobile={isMobile} />}
          {hasToolCalls && (
            <ToolCallGroup
              toolCalls={message.toolCalls!}
              isMobile={isMobile}
              onOpenFile={onOpenFile}
            />
          )}
        </>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="text-2xl text-muted-foreground animate-pulse">
          ...
        </div>
      )}
    </div>
  )
}

// =============================================================================
// System Message (for git operations and other system messages)
// =============================================================================

interface SystemMessageProps {
  icon: LucideIcon
  content: string
  variant?: "success" | "error"
  isMobile?: boolean
  repo?: string
  linkBranch?: string
  metadata?: MessageMetadata
  onForcePush?: () => void
}

function SystemMessage({ icon: Icon, content, variant = "success", isMobile = false, repo, linkBranch, metadata, onForcePush }: SystemMessageProps) {
  const iconClasses = cn(
    "shrink-0",
    variant === "error" && "text-red-500 dark:text-red-400",
    variant === "success" && "text-green-600 dark:text-green-400",
    isMobile ? "h-4 w-4" : "h-3.5 w-3.5"
  )

  // Link the merge message to the target branch on GitHub, if we know it.
  const branchUrl = repo && linkBranch ? `https://github.com/${repo}/tree/${linkBranch}` : null

  // Parse "Merged X into Y" / "Squash merged X into Y" to bold the two names,
  // whether they're branch names or chat titles.
  const parseMergeMessage = (text: string) => {
    const mergeMatch = text.match(/^((?:Squash )?[Mm]erged )(.+?)( into )(.+?)([.]?)$/)
    if (mergeMatch) {
      const [, prefix, source, mid, target, suffix] = mergeMatch
      return { prefix, source, mid, target, suffix }
    }
    return null
  }

  // Check if this message has a force-push action via metadata
  const hasForcePushAction = metadata?.action === "force-push" && onForcePush

  // Find "force push" text in content to make it clickable
  const FORCE_PUSH_TEXT = "force push"
  const forcePushIdx = hasForcePushAction ? content.toLowerCase().indexOf(FORCE_PUSH_TEXT) : -1
  const hasForcePushLink = forcePushIdx !== -1

  const parsed = parseMergeMessage(content)

  const renderContent = () => {
    if (hasForcePushLink && onForcePush) {
      const before = content.slice(0, forcePushIdx)
      const after = content.slice(forcePushIdx + FORCE_PUSH_TEXT.length)
      return (
        <>
          {before}
          <button
            type="button"
            onClick={onForcePush}
            className="font-semibold underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer"
          >
            force push
          </button>
          {after}
        </>
      )
    }
    if (!parsed) return content
    return (
      <>
        {parsed.prefix}
        <span className="font-semibold">{parsed.source}</span>
        {parsed.mid}
        <span className="font-semibold">{parsed.target}</span>
        {parsed.suffix}
      </>
    )
  }

  return (
    <div className={cn(
      "flex items-start gap-2",
      isMobile ? "text-base" : "text-sm"
    )}>
      <Icon className={cn(iconClasses, "mt-0.5")} />
      {branchUrl && !hasForcePushLink ? (
        <a
          href={branchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {renderContent()}
        </a>
      ) : (
        <span className="text-muted-foreground">{renderContent()}</span>
      )}
    </div>
  )
}

function getToolIcon(toolName: string): LucideIcon {
  switch (toolName) {
    case "Bash":
      return Terminal
    case "Read":
    case "Edit":
    case "Write":
      return FileText
    case "Glob":
    case "Grep":
      return Search
    default:
      return Terminal
  }
}

// =============================================================================
// Helper: Merge consecutive tool_calls blocks
// =============================================================================

function mergeConsecutiveToolCalls(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []
  let currentToolCalls: ToolCall[] = []

  for (const block of blocks) {
    if (block.type === "tool_calls") {
      // Accumulate tool calls
      currentToolCalls.push(...block.toolCalls)
    } else {
      // Flush accumulated tool calls before adding text
      if (currentToolCalls.length > 0) {
        result.push({ type: "tool_calls", toolCalls: currentToolCalls })
        currentToolCalls = []
      }
      result.push(block)
    }
  }

  // Flush any remaining tool calls
  if (currentToolCalls.length > 0) {
    result.push({ type: "tool_calls", toolCalls: currentToolCalls })
  }

  return result
}

// =============================================================================
// Tool Call Group (shows all tool calls together in unified block)
// =============================================================================

interface ToolCallGroupProps {
  toolCalls: ToolCall[]
  onOpenFile?: (filePath: string) => void
  isMobile?: boolean
}

function ToolCallGroup({ toolCalls, isMobile = false, onOpenFile }: ToolCallGroupProps) {
  if (toolCalls.length === 0) return null

  return (
    <div>
      {toolCalls.map((tool, index) => (
        <ToolCallRow
          key={`${tool.tool}-${tool.summary}-${index}`}
          tool={tool}
          isMobile={isMobile}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  )
}

// Individual tool call row within the group
interface ToolCallRowProps {
  tool: ToolCall
  isMobile?: boolean
  onOpenFile?: (filePath: string) => void
}

function ToolCallRow({ tool, isMobile = false, onOpenFile }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(tool.tool)
  const hasOutput = !!tool.output
  const hasFileLink = !!(tool.filePath && onOpenFile)

  const handleRowClick = () => {
    if (hasFileLink) return // filename has its own click handler
    if (hasOutput) setExpanded(!expanded)
  }

  // Summaries from the agent typically look like "Write: hello.html" — when
  // we have a file link, only the part after the tool prefix should be the
  // clickable link, not the entire row text.
  const { prefix, linkText } = splitToolSummary(tool.summary)

  const openFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tool.filePath && onOpenFile) onOpenFile(tool.filePath)
  }

  return (
    <div
      onClick={handleRowClick}
      className={cn(
        isMobile ? "py-1" : "py-0.5",
        hasOutput && !hasFileLink && "cursor-pointer"
      )}
    >
      {/* Tool call header */}
      <div className={cn(
        "flex items-center gap-1.5 text-muted-foreground transition-colors",
        isMobile ? "text-sm" : "text-[13px]",
        hasOutput && !hasFileLink && "hover:text-foreground"
      )}>
        <Icon className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
        <span className="truncate">
          {hasFileLink ? (
            <>
              {prefix}
              <span
                onClick={openFile}
                className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-foreground"
              >
                {linkText}
              </span>
            </>
          ) : (
            tool.summary
          )}
        </span>
        {hasOutput && !hasFileLink && (
          expanded ? (
            <ChevronDown className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          ) : (
            <ChevronRight className={cn("shrink-0", isMobile ? "h-4 w-4" : "h-3 w-3")} />
          )
        )}
      </div>

      {/* Tool output - block quote style with left border */}
      {expanded && tool.output && (
        <pre className={cn(
          "font-mono whitespace-pre-wrap overflow-x-auto max-w-full mobile-scroll text-muted-foreground mt-1.5 pl-3 border-l-2 border-border",
          isMobile ? "text-xs max-h-64 ml-5" : "text-[11px] max-h-48 ml-4"
        )}>
          {tool.output}
        </pre>
      )}
    </div>
  )
}

/** Split a tool summary like "Write: hello.html" into a prefix + clickable
 *  detail. Falls back to linking the whole summary when there's no colon. */
function splitToolSummary(summary: string): { prefix: string; linkText: string } {
  const idx = summary.indexOf(": ")
  if (idx < 0) return { prefix: "", linkText: summary }
  return { prefix: summary.slice(0, idx + 2), linkText: summary.slice(idx + 2) }
}
