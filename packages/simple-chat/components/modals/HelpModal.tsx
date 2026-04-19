"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { X, HelpCircle } from "lucide-react"
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
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-xl shadow-xl"
          )}
        >
          <div className="flex items-center justify-between border-b border-border bg-popover px-4 py-2">
            <Dialog.Title className="font-medium flex items-center gap-2 text-sm">
              <HelpCircle className="h-4 w-4" />
              Help
            </Dialog.Title>
            <Dialog.Close className="flex items-center justify-center rounded-lg hover:bg-accent transition-colors p-1">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          <div className={cn(
            "space-y-4 text-sm",
            isMobile ? "p-4" : "p-5"
          )}>
            <section>
              <h3 className="font-medium mb-1.5">Getting started</h3>
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Select the agent you want to use.</li>
                <li>Send a message to the agent. A sandbox is created on the first prompt.</li>
                <li>The agent edits code on a new branch and pushes it to the selected repository.</li>
              </ol>
            </section>

            <section>
              <h3 className="font-medium mb-1.5">Keyboard shortcuts</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘P</kbd> Search chats, repos, and branches</li>
                <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌘K</kbd> Command palette</li>
                <li><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-mono">⌥↑/↓</kbd> Switch chats</li>
              </ul>
            </section>

            <section>
              <h3 className="font-medium mb-1.5">Git actions</h3>
              <p className="text-muted-foreground">
                Type <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/</code> in the prompt for merge, rebase, squash, and PR.
              </p>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
