import type { ReactNode } from "react"
import { Github, HelpCircle, Command } from "lucide-react"
import { cn } from "@/lib/utils"

interface WelcomeViewProps {
  isMobile: boolean
  onOpenCommandPalette?: () => void
  onOpenHelp: () => void
  /** The composer input element, built by ChatPanel and shared with other views. */
  chatInput: ReactNode
  /** The file-preview modal element (or null), shared with other views. */
  filePreviewModal: ReactNode
}

/**
 * Centered welcome screen shown for a brand-new chat with no messages yet:
 * heading, open-source link, help/command-palette buttons, and the composer.
 */
export function WelcomeView({
  isMobile,
  onOpenCommandPalette,
  onOpenHelp,
  chatInput,
  filePreviewModal,
}: WelcomeViewProps) {
  return (
    <>
      <div className={cn(
        "flex-1 flex flex-col items-center justify-center bg-background relative",
        isMobile ? "p-4 pb-safe" : "p-4"
      )}>
        <div className="absolute top-3 right-3 flex items-center gap-1">
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Commands"
              aria-label="Open commands"
            >
              <Command className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onOpenHelp}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Help"
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
        <a
          href="https://github.com/jamesmurdza/background-agents"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-5 flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 text-sm text-foreground/70 hover:text-foreground transition-colors"
        >
          <Github className="h-3.5 w-3.5" />
          Backgrounder is open source.
        </a>
        <div className="text-center mb-6">
          <h2 className={cn("font-semibold", isMobile ? "text-xl" : "text-2xl")}>
            What would you like to build?
          </h2>
        </div>
        {chatInput}
        <div className={cn(
          "text-muted-foreground mt-4 text-center",
          isMobile ? "text-sm px-4" : "text-sm"
        )}>
          <p>
            Changes will apply when you type /merge. Access tools with ⌘K.
          </p>
        </div>
      </div>
      {filePreviewModal}
    </>
  )
}
