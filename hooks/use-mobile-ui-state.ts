import { useState } from "react"

/**
 * Manages all mobile-specific UI state (modals, drawers, loading states)
 */
export function useMobileUIState() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileSandboxToggleLoading, setMobileSandboxToggleLoading] = useState(false)
  const [mobilePrLoading, setMobilePrLoading] = useState(false)
  const [mobileDiffOpen, setMobileDiffOpen] = useState(false)
  const [mobileMergeOpen, setMobileMergeOpen] = useState(false)
  const [mobileRebaseOpen, setMobileRebaseOpen] = useState(false)
  const [mobileTagOpen, setMobileTagOpen] = useState(false)
  const [mobileResetOpen, setMobileResetOpen] = useState(false)

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

    // Modals
    mobileDiffOpen,
    setMobileDiffOpen,
    mobileMergeOpen,
    setMobileMergeOpen,
    mobileRebaseOpen,
    setMobileRebaseOpen,
    mobileTagOpen,
    setMobileTagOpen,
    mobileResetOpen,
    setMobileResetOpen,
  }
}

export type MobileUIState = ReturnType<typeof useMobileUIState>
