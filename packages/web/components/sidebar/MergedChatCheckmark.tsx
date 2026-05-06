import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface MergedChatCheckmarkProps {
  className?: string
}

export function MergedChatCheckmark({ className }: MergedChatCheckmarkProps) {
  return (
    <Check
      className={cn("h-3 w-3 text-sidebar-foreground/75 dark:text-zinc-300", className)}
      strokeWidth={2.4}
    />
  )
}
