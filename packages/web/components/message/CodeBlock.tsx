"use client"

import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCopyToClipboard, extractCodeText } from "@/lib/hooks/useCopyToClipboard"

interface CodeBlockProps {
  children: React.ReactNode
  isMobile?: boolean
  /** "default" matches the chat message theme; "github" is the GitHub-style
   * fixed light/dark palette used for read-only markdown file previews. */
  variant?: "default" | "github"
}

export function CodeBlock({ children, isMobile = false, variant = "default" }: CodeBlockProps) {
  const { copied, copy } = useCopyToClipboard()
  const isGithub = variant === "github"

  const handleCopy = () => copy(extractCodeText(children))

  return (
    <div
      className={cn(
        "relative group min-w-0 max-w-full overflow-hidden",
        isGithub ? "mb-4 last:mb-0" : "my-4 first:mt-0 last:mb-0"
      )}
    >
      <pre
        className={cn(
          "w-full overflow-x-auto max-w-full rounded-md border p-3",
          isGithub
            ? "p-4 bg-[#f6f8fa] dark:bg-[#161b22] border-[#d0d7de] dark:border-[#30363d]"
            : cn("border-border/70 bg-white/70 dark:bg-white/[0.03]", isMobile && "rounded-lg")
        )}
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md cursor-pointer",
          "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-all",
          isGithub
            ? "bg-[#f6f8fa] dark:bg-[#21262d] hover:bg-[#eaeef2] dark:hover:bg-[#30363d] border border-[#d0d7de] dark:border-[#30363d]"
            : "hover:bg-muted",
          copied && "opacity-100"
        )}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <Check className={cn("h-4 w-4", isGithub ? "text-green-600 dark:text-green-400" : "text-green-500")} />
        ) : (
          <Copy className={cn("h-4 w-4", isGithub ? "text-[#656d76] dark:text-[#848d97]" : "text-muted-foreground")} />
        )}
      </button>
    </div>
  )
}
