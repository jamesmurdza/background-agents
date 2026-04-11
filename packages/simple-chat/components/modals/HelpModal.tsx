"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { X, MessageSquare, GitBranch, Zap, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

interface HelpModalProps {
  open: boolean
  onClose: () => void
  isMobile?: boolean
}

export function HelpModal({ open, onClose, isMobile = false }: HelpModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover shadow-xl outline-none",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl max-w-md w-[90vw] max-h-[85vh]"
          )}
        >
          {/* Header */}
          <div className={cn(
            "flex items-center justify-between border-b border-border",
            isMobile ? "px-4 py-4" : "px-5 py-4"
          )}>
            <Dialog.Title className={cn(
              "font-semibold",
              isMobile ? "text-lg" : "text-base"
            )}>
              How to Use
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className={cn(
            "overflow-y-auto",
            isMobile ? "px-4 py-4 space-y-5" : "px-5 py-4 space-y-4"
          )}>
            <HelpSection
              icon={MessageSquare}
              title="Chat with AI"
              isMobile={isMobile}
            >
              Type your request in the message field. The AI agent will read files, write code, and run commands to complete your task.
            </HelpSection>

            <HelpSection
              icon={GitBranch}
              title="Git Integration"
              isMobile={isMobile}
            >
              Each chat creates a new branch. Changes are committed automatically. Use the GitHub icon to view your branch online.
            </HelpSection>

            <HelpSection
              icon={Zap}
              title="Slash Commands"
              isMobile={isMobile}
            >
              Type <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">/</code> to see available commands like <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">/pr</code> to create a pull request.
            </HelpSection>

            <HelpSection
              icon={Settings}
              title="Configuration"
              isMobile={isMobile}
            >
              Click the settings icon to add API keys and choose your preferred AI model. Different models have different capabilities and costs.
            </HelpSection>
          </div>

          {/* Footer */}
          <div className={cn(
            "border-t border-border",
            isMobile ? "px-4 py-4" : "px-5 py-3"
          )}>
            <button
              onClick={onClose}
              className={cn(
                "w-full rounded-lg bg-primary text-primary-foreground font-medium transition-colors hover:bg-primary/90",
                isMobile ? "py-3 text-base" : "py-2 text-sm"
              )}
            >
              Got it
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function HelpSection({
  icon: Icon,
  title,
  children,
  isMobile = false,
}: {
  icon: typeof MessageSquare
  title: string
  children: React.ReactNode
  isMobile?: boolean
}) {
  return (
    <div className="flex gap-3">
      <div className={cn(
        "shrink-0 rounded-lg bg-muted flex items-center justify-center",
        isMobile ? "w-10 h-10" : "w-8 h-8"
      )}>
        <Icon className={cn(
          "text-muted-foreground",
          isMobile ? "h-5 w-5" : "h-4 w-4"
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={cn(
          "font-medium mb-1",
          isMobile ? "text-base" : "text-sm"
        )}>
          {title}
        </h3>
        <p className={cn(
          "text-muted-foreground leading-relaxed",
          isMobile ? "text-sm" : "text-xs"
        )}>
          {children}
        </p>
      </div>
    </div>
  )
}
