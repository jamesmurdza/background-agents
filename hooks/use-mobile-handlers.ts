import { useCallback } from "react"
import type { Branch } from "@/lib/types"
import type { TransformedRepo } from "@/lib/db-types"

interface UseMobileHandlersOptions {
  activeBranch: Branch | null
  activeRepo: TransformedRepo | null
  handleUpdateBranch: (branchId: string, updates: Partial<Branch>) => void
  mobileSandboxToggleLoading: boolean
  setMobileSandboxToggleLoading: React.Dispatch<React.SetStateAction<boolean>>
  mobilePrLoading: boolean
  setMobilePrLoading: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * Provides mobile-specific action handlers (sandbox toggle, PR creation)
 */
export function useMobileHandlers({
  activeBranch,
  activeRepo,
  handleUpdateBranch,
  mobileSandboxToggleLoading,
  setMobileSandboxToggleLoading,
  mobilePrLoading,
  setMobilePrLoading,
}: UseMobileHandlersOptions) {
  // Toggle sandbox start/stop
  const handleMobileSandboxToggle = useCallback(async () => {
    if (!activeBranch?.sandboxId || mobileSandboxToggleLoading) return
    const isStopped = activeBranch.status === "stopped"
    setMobileSandboxToggleLoading(true)
    try {
      const res = await fetch("/api/sandbox/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: activeBranch.sandboxId,
          action: isStopped ? "start" : "stop",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      handleUpdateBranch(activeBranch.id, { status: isStopped ? "idle" : "stopped" })
    } catch {
      // ignore
    } finally {
      setMobileSandboxToggleLoading(false)
    }
  }, [activeBranch, mobileSandboxToggleLoading, handleUpdateBranch, setMobileSandboxToggleLoading])

  // Create or open PR
  const handleMobileCreatePR = useCallback(async () => {
    if (!activeBranch || !activeRepo) return
    // If PR already exists, just open it
    if (activeBranch.prUrl) {
      window.open(activeBranch.prUrl, "_blank")
      return
    }
    setMobilePrLoading(true)
    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: activeRepo.owner,
          repo: activeRepo.name,
          head: activeBranch.name,
          base: activeBranch.baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      handleUpdateBranch(activeBranch.id, { prUrl: data.url })
      window.open(data.url, "_blank")
    } catch {
      // Silently fail
    } finally {
      setMobilePrLoading(false)
    }
  }, [activeBranch, activeRepo, handleUpdateBranch, setMobilePrLoading])

  return {
    handleMobileSandboxToggle,
    handleMobileCreatePR,
  }
}

export type MobileHandlers = ReturnType<typeof useMobileHandlers>
