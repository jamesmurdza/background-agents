import { cn } from "@/lib/utils"

/** Italic serif "𝑥" used to denote environment variables / chat settings. */
export function VariableIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center italic font-serif", className)}>
      𝑥
    </span>
  )
}
