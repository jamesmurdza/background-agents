"use client"

import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MessageMetadata } from "@/lib/types"

// =============================================================================
// System Message - For git operations and other system notifications
// =============================================================================

export interface SystemMessageProps {
  icon: LucideIcon
  content: string
  variant?: "success" | "error"
  isMobile?: boolean
  repo?: string
  linkBranch?: string
  metadata?: MessageMetadata
  onForcePush?: () => void
}

export function SystemMessage({ icon: Icon, content, variant = "success", isMobile = false, repo, linkBranch, metadata, onForcePush }: SystemMessageProps) {
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
