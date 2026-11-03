"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { HelpCircle, ChevronRight, Keyboard, BookOpen, Github, Mail, Bug, Sparkles } from "lucide-react"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { GITHUB_REPO_URL } from "@/lib/bonus-credits"
import { DOCS_URL } from "@/lib/constants"

interface HelpModalProps {
  open: boolean
  onClose: () => void
  isMobile?: boolean
}

const SUPPORT_EMAIL = "james@backgrounder.dev"

const LINKS = [
  { label: "Documentation", icon: BookOpen, href: DOCS_URL },
  { label: "Keyboard shortcuts", icon: Keyboard, href: `${DOCS_URL}/#/keyboard-shortcuts` },
  { label: "Report a bug", icon: Bug, href: `${GITHUB_REPO_URL}/issues/new?template=bug_report.md` },
  { label: "Request a feature", icon: Sparkles, href: `${GITHUB_REPO_URL}/issues/new?template=feature_request.md` },
  { label: "GitHub repo", icon: Github, href: GITHUB_REPO_URL },
  { label: "Email support", icon: Mail, href: `mailto:${SUPPORT_EMAIL}` },
]

export function HelpModal({ open, onClose, isMobile = false }: HelpModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          MODAL_OVERLAY_CLASS,
          "transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <HelpCircle className="h-4 w-4" />
                Help
              </>
            }
          />

          <div className={cn(
            "space-y-4 text-sm",
            isMobile ? "p-4" : "p-5"
          )}>
            <section className="space-y-2 text-muted-foreground">
              <p>
                Describe what you want built or changed in the message box, and send it. An agent
                works on it in the background—in its own sandbox, on its own branch—so you&apos;re
                free to start another chat or even close your laptop and come back later.
              </p>
              <p>
                Type <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/</code> in
                the prompt for git actions like merge, rebase, squash, and opening a PR.
              </p>
              <p>
                Need help or have feedback? Use any of the ways below.
              </p>
            </section>

            <section className="space-y-1.5">
              {LINKS.map(({ label, icon: Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
