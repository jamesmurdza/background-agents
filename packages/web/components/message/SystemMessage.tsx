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

  // Match the text colour to the (red) error icon; other variants keep the
  // muted treatment.
  const textClasses = variant === "error"
    ? "text-red-500 dark:text-red-400"
    : "text-muted-foreground"

  // Link the merge message to the target branch on GitHub, if we know it.
  const branchUrl = repo && linkBranch ? `https://github.com/${repo}/tree/${linkBranch}` : null

  // Link for view-pr action
  const prUrl = metadata?.action === "view-pr" && metadata?.prUrl ? metadata.prUrl : null

  // Parse git-operation messages to bold the branch/chat names.
  // Two-name patterns: "Merged X into Y", "Squash merged X into Y", "Rebased X onto Y"
  // One-name patterns: "Force pushed X", "Squashed N commits on B"
  const parseOperationMessage = (text: string):
    | { type: "two"; prefix: string; source: string; mid: string; target: string; suffix: string }
    | { type: "one"; prefix: string; name: string; suffix: string }
    | null => {
    const twoMatch = text.match(/^((?:Squash )?[Mm]erged |Rebased )(.+?)( (?:into|onto) )(.+?)(\.?)$/)
    if (twoMatch) {
      const [, prefix, source, mid, target, suffix] = twoMatch
      return { type: "two", prefix, source, mid, target, suffix }
    }
    const oneMatch = text.match(/^(Force pushed |Squashed .+? on )(.+?)(\.?)$/)
    if (oneMatch) {
      const [, prefix, name, suffix] = oneMatch
      return { type: "one", prefix, name, suffix }
    }
    return null
  }

  // Check if this message has a force-push action via metadata
  const hasForcePushAction = metadata?.action === "force-push" && onForcePush

  // Find "force push" text in content to make it clickable
  const FORCE_PUSH_TEXT = "force push"
  const forcePushIdx = hasForcePushAction ? content.toLowerCase().indexOf(FORCE_PUSH_TEXT) : -1
  const hasForcePushLink = forcePushIdx !== -1

  const parsed = parseOperationMessage(content)

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
    if (parsed.type === "two") {
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
      <>
        {parsed.prefix}
        <span className="font-semibold">{parsed.name}</span>
        {parsed.suffix}
      </>
    )
  }

  // Determine the link URL (PR link takes precedence over branch link)
  const linkUrl = prUrl || (branchUrl && !hasForcePushLink ? branchUrl : null)

  return (
    <div className={cn(
      "flex items-start gap-2",
      isMobile ? "text-base" : "text-sm"
    )}>
      <Icon className={cn(iconClasses, "mt-0.5")} />
      {linkUrl ? (
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(textClasses, "hover:text-foreground transition-colors")}
        >
          {renderContent()}
        </a>
      ) : (
        <span className={textClasses}>{renderContent()}</span>
      )}
    </div>
  )
}
