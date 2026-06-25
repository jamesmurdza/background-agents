"use client"

import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCopyToClipboard, extractCodeText } from "@/lib/hooks/useCopyToClipboard"

interface CodeBlockProps {
  children: React.ReactNode
  isMobile?: boolean
}

export function CodeBlock({ children, isMobile = false }: CodeBlockProps) {
  const { copied, copy } = useCopyToClipboard()

  const handleCopy = () => copy(extractCodeText(children))

  return (
    <div className="relative group my-4 first:mt-0 last:mb-0 min-w-0 max-w-full overflow-hidden">
      <pre className={cn(
        "w-full overflow-x-auto max-w-full rounded-md border border-border/70 p-3",
        "bg-white/70 dark:bg-white/[0.03]",
        isMobile && "rounded-lg"
      )}>
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md cursor-pointer",
          "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 transition-all",
          "hover:bg-muted",
          copied && "opacity-100"
        )}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    </div>
  )
}
