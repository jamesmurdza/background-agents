import { useState, useEffect, useRef } from "react"
import type { Branch } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"

interface UseDraftSyncOptions {
  branch: Branch
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
}

/**
 * Manages draft prompt state with persistence across branch switches and page unload
 */
export function useDraftSync({ branch, onSaveDraftForBranch }: UseDraftSyncOptions) {
  const [input, setInput] = useState(branch.draftPrompt ?? "")
  const inputRef = useRef(input)
  inputRef.current = input

  const prevBranchIdRef = useRef(branch.id)
  const prevBranchNameRef = useRef(branch.name)
  const isNearBottomRef = useRef(true)

  // Sync input when switching branches - save old draft then load new
  useEffect(() => {
    if (prevBranchIdRef.current !== branch.id) {
      const prevBranchId = prevBranchIdRef.current
      const prevBranchName = prevBranchNameRef.current
      const currentInput = inputRef.current

      // Check if this is a real branch switch (different branch name) or just an ID update
      const isRealBranchSwitch = prevBranchName !== branch.name

      // Save draft for previous branch
      if (currentInput && isRealBranchSwitch) {
        if (onSaveDraftForBranch) {
          onSaveDraftForBranch(prevBranchId, currentInput)
        } else {
          fetch("/api/branches", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: prevBranchId, draftPrompt: currentInput }),
          }).catch(() => {})
        }
      }

      // Only load draft from new branch if it's a real branch switch
      if (isRealBranchSwitch) {
        setInput(branch.draftPrompt ?? "")
        // Reset scroll behavior on branch switch so we scroll to bottom
        isNearBottomRef.current = true
      }

      prevBranchIdRef.current = branch.id
      prevBranchNameRef.current = branch.name
    }
  }, [branch.id, branch.name, branch.draftPrompt, onSaveDraftForBranch])

  // Save draft on page unload/close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (branch.status === BRANCH_STATUS.CREATING) return
      const currentInput = inputRef.current
      if (currentInput && currentInput !== (branch.draftPrompt ?? "")) {
        navigator.sendBeacon(
          "/api/branches/draft",
          new Blob(
            [JSON.stringify({ branchId: branch.id, draftPrompt: currentInput })],
            { type: "application/json" }
          )
        )
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [branch.id, branch.draftPrompt, branch.status])

  return {
    input,
    setInput,
    inputRef,
    isNearBottomRef,
  }
}
