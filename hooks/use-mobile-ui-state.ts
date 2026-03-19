import { useState } from "react"

/**
 * Manages mobile-specific UI state (modals, drawers, loading states)
 * Note: merge/rebase/tag dialogs are now handled by the shared useGitDialogs hook
 */
export function useMobileUIState() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileSandboxToggleLoading, setMobileSandboxToggleLoading] = useState(false)
  const [mobilePrLoading, setMobilePrLoading] = useState(false)
  const [mobileDiffOpen, setMobileDiffOpen] = useState(false)

  return {
    // Sidebar
    mobileSidebarOpen,
    setMobileSidebarOpen,

    // Sandbox toggle
    mobileSandboxToggleLoading,
    setMobileSandboxToggleLoading,

    // PR creation
    mobilePrLoading,
    setMobilePrLoading,

    // Diff modal
    mobileDiffOpen,
    setMobileDiffOpen,
  }
}

export type MobileUIState = ReturnType<typeof useMobileUIState>
