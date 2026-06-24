"use client"

import type { ComponentProps } from "react"
import { CreateRepoModal } from "@/components/modals/CreateRepoModal"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { SignInModal } from "@/components/modals/SignInModal"
import { ReAuthBanner } from "@/components/modals/ReAuthBanner"
import { HelpModal } from "@/components/modals/HelpModal"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { LimitReachedDialog } from "@/components/modals/LimitReachedDialog"
import { ChatUsageModal } from "@/components/modals/ChatUsageModal"
import {
  MergeDialog,
  RebaseDialog,
  PRDialog,
  SquashDialog,
} from "@/components/modals/git-dialogs"
import { EnvironmentVariablesModal } from "@/components/modals/EnvironmentVariablesModal"
import { MobileCommandsMenu } from "@/components/MobileCommandsMenu"
import { MobileRenameModal } from "@/components/ui/MobileBottomSheet"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { SkillSearchView } from "@/components/skills/SkillSearchView"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { useModals, useGit, useChat } from "@/lib/contexts"
import { NEW_REPOSITORY } from "@/lib/types"

// =============================================================================
// AppModals — renders the application's modal/dialog "farm".
// =============================================================================
// All of these dialogs were previously inlined at the bottom of page.tsx. They
// read open/close state from ModalContext, git state from GitContext, and chat
// state from ChatContext, so only the handful of callbacks/state that live in
// the page are passed as props.
//
// Must be rendered inside ModalProvider, GitProvider, and ChatProvider.

interface AppModalsProps {
  isMobile: boolean
  /** Whether the stored GitHub token has expired/been revoked (drives ReAuthBanner). */
  githubTokenInvalid: boolean
  /** Called when the user dismisses the re-auth banner. */
  onDismissReAuthBanner: () => void

  // Create-repo modal — called with the newly-created repo + default branch.
  onRepoSelect: ComponentProps<typeof CreateRepoModal>["onSelect"]

  // Settings
  onSaveSettings: ComponentProps<typeof SettingsModal>["onSave"]

  // Environment variables
  onSaveEnvVars: ComponentProps<typeof EnvironmentVariablesModal>["onSave"]
  envVarsChatEnvVars: Record<string, string>
  envVarsRepoEnvVars: Record<string, string>

  // Skills search
  skillsModalOpen: boolean
  onSkillsModalOpenChange: (open: boolean) => void

  // Scheduled jobs — fired after a job is created/saved (e.g. to refresh the list)
  onScheduledJobSuccess: () => void

  // Mobile commands menu
  onSlashCommand: (command: SlashCommandType) => void

  // Delete confirmation — receives the chat id to delete
  onDeleteChat: (chatId: string) => void

  // Daily limit reached dialog
  limitReachedState: { show: boolean; resetAt?: Date; provider?: string; used?: number | null; limit?: number | null }
  onDismissLimitReached: () => void
  onContinueWithOpenCode: () => void
}

export function AppModals({
  isMobile,
  githubTokenInvalid,
  onDismissReAuthBanner,
  onRepoSelect,
  onSaveSettings,
  onSaveEnvVars,
  envVarsChatEnvVars,
  envVarsRepoEnvVars,
  skillsModalOpen,
  onSkillsModalOpenChange,
  onScheduledJobSuccess,
  onSlashCommand,
  onDeleteChat,
  limitReachedState,
  onDismissLimitReached,
  onContinueWithOpenCode,
}: AppModalsProps) {
  const modals = useModals()
  const gitDialogs = useGit()
  const { currentChat, currentChatId, chats, settings, credentialFlags, renameChat } = useChat()

  return (
    <>
      <CreateRepoModal
        open={modals.repoCreateOpen}
        onClose={() => modals.setRepoCreateOpen(false)}
        onSelect={onRepoSelect}
        isMobile={isMobile}
        suggestedName={currentChat?.displayName ?? null}
      />

      <SettingsModal
        open={modals.settingsOpen}
        onClose={modals.closeSettings}
        settings={settings}
        credentialFlags={credentialFlags}
        onSave={onSaveSettings}
        highlightKey={modals.settingsHighlightKey}
        defaultSection={modals.settingsDefaultSection}
        isMobile={isMobile}
      />

      <EnvironmentVariablesModal
        open={modals.envVarsModalOpen}
        onClose={() => modals.setEnvVarsModalOpen(false)}
        chatId={currentChatId || ""}
        repoName={currentChat?.repo !== NEW_REPOSITORY ? currentChat?.repo : undefined}
        onSave={onSaveEnvVars}
        initialChatEnvVars={envVarsChatEnvVars}
        initialRepoEnvVars={envVarsRepoEnvVars}
        isMobile={isMobile}
      />

      {/* Skills Search Modal */}
      {currentChat?.sandboxId && currentChat.repo !== NEW_REPOSITORY && (
        <SkillSearchView
          open={skillsModalOpen}
          onOpenChange={onSkillsModalOpenChange}
          chatId={currentChat.id}
          repo={currentChat.repo}
        />
      )}

      {/* Git Dialogs - now use API calls instead of pasting git commands */}
      <MergeDialog
        open={gitDialogs.mergeOpen}
        onClose={() => gitDialogs.setMergeOpen(false)}
        gitDialogs={gitDialogs}
        chat={currentChat}
        isMobile={isMobile}
      />
      <RebaseDialog
        open={gitDialogs.rebaseOpen}
        onClose={() => gitDialogs.setRebaseOpen(false)}
        gitDialogs={gitDialogs}
        chat={currentChat}
        isMobile={isMobile}
      />
      <PRDialog
        open={gitDialogs.prOpen}
        onClose={() => gitDialogs.setPROpen(false)}
        gitDialogs={gitDialogs}
        chat={currentChat}
        isMobile={isMobile}
      />
      <SquashDialog
        open={gitDialogs.squashOpen}
        onClose={() => gitDialogs.setSquashOpen(false)}
        gitDialogs={gitDialogs}
        chat={currentChat}
        isMobile={isMobile}
      />

      {/* Sign In Modal - shown when user tries to send message without being signed in */}
      <SignInModal
        open={modals.signInModalOpen}
        onClose={() => modals.setSignInModalOpen(false)}
        isMobile={isMobile}
      />

      {/* Re-auth banner — shown when stored GitHub token has expired or been revoked. */}
      <ReAuthBanner
        open={githubTokenInvalid}
        onDismiss={onDismissReAuthBanner}
        isMobile={isMobile}
      />

      <HelpModal
        open={modals.helpOpen}
        onClose={() => modals.setHelpOpen(false)}
        isMobile={isMobile}
      />

      {/* Scheduled Job Form */}
      <ScheduledJobForm
        open={modals.scheduledJobFormOpen}
        onClose={() => modals.setScheduledJobFormOpen(false)}
        onSuccess={() => {
          modals.setScheduledJobFormOpen(false)
          onScheduledJobSuccess()
        }}
        isMobile={isMobile}
      />

      {/* Mobile Commands Menu */}
      {isMobile && (
        <MobileCommandsMenu
          open={modals.mobileCommandsOpen}
          onClose={() => modals.setMobileCommandsOpen(false)}
          onSlashCommand={onSlashCommand}
          hasLinkedRepo={!!(currentChat && currentChat.repo !== NEW_REPOSITORY)}
          inConflict={!!(gitDialogs.rebaseConflict?.inRebase || gitDialogs.rebaseConflict?.inMerge)}
        />
      )}

      <ConfirmDialog
        open={modals.deleteConfirmChatId !== null}
        onClose={() => modals.setDeleteConfirmChatId(null)}
        onConfirm={() => {
          if (modals.deleteConfirmChatId) onDeleteChat(modals.deleteConfirmChatId)
        }}
        title="Delete chat"
        description={
          <>
            Delete{" "}
            <span className="font-medium text-foreground">
              {chats.find((c) => c.id === modals.deleteConfirmChatId)?.displayName || "this chat"}
            </span>
            ? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isMobile={isMobile}
      />

      {/* Mobile Rename Modal */}
      <MobileRenameModal
        open={modals.mobileRenameChat !== null}
        onClose={() => modals.setMobileRenameChat(null)}
        title="Rename Chat"
        initialValue={modals.mobileRenameChat?.name ?? ""}
        onSave={(newName) => {
          if (modals.mobileRenameChat) {
            renameChat(modals.mobileRenameChat.id, newName)
          }
        }}
        placeholder="Chat name"
      />

      {/* Daily Limit Reached Dialog */}
      <LimitReachedDialog
        open={limitReachedState.show}
        onClose={onDismissLimitReached}
        provider={limitReachedState.provider}
        used={limitReachedState.used}
        limit={limitReachedState.limit}
        onContinueWithOpenCode={onContinueWithOpenCode}
        onAddApiKey={() => {
          onDismissLimitReached()
          const key =
            limitReachedState.provider === "gemini"
              ? "gemini"
              : limitReachedState.provider === "opencode"
                ? "opencode"
                : "anthropic"
          modals.openSettings(key)
        }}
        onUpgradeToPro={() => {
          onDismissLimitReached()
          window.open("mailto:james@jamesmurdza.com?subject=Upgrade%20to%20Pro", "_blank")
        }}
        resetAt={limitReachedState.resetAt}
        isMobile={isMobile}
      />

      {/* Per-chat token usage (opened from the command palette) */}
      <ChatUsageModal
        chatId={modals.chatUsageChatId}
        onClose={modals.closeChatUsage}
        isMobile={isMobile}
      />
    </>
  )
}
