import { useState, useEffect, useRef, useCallback } from "react"
import type { Branch } from "@/lib/shared/types"
import { BRANCH_STATUS } from "@/lib/shared/constants"

interface UseDraftSyncOptions {
  branch: Branch
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
}

// Debounce delay for auto-save (ms)
const AUTOSAVE_DEBOUNCE_MS = 1000

/**
 * Manages draft prompt state with persistence across branch switches and page unload.
 *
 * Key behaviors:
 * 1. Auto-saves draft to DB as user types (debounced)
 * 2. Saves draft immediately when component unmounts (branch/repo switch)
 * 3. Saves draft on page unload/close using sendBeacon
 * 4. Loads draft from DB when switching to a new branch
 */
export function useDraftSync({ branch, onSaveDraftForBranch }: UseDraftSyncOptions) {
  const [input, setInputState] = useState(branch.draftPrompt ?? "")
  const inputRef = useRef(input)

  // Wrapper that updates ref immediately (before React re-renders)
  // This ensures inputRef.current is always current, even if the component
  // unmounts before the next render (e.g., when switching branches quickly)
  const setInput = useCallback((value: string) => {
    inputRef.current = value
    setInputState(value)
  }, [])

  // Track the branch we're currently editing - captured once on mount
  // DO NOT update this on every render, or it will have the wrong value during unmount
  const branchIdRef = useRef(branch.id)

  const prevBranchIdRef = useRef(branch.id)
  const prevBranchNameRef = useRef(branch.name)
  const isNearBottomRef = useRef(true)

  // Track last saved value to avoid unnecessary saves
  const lastSavedDraftRef = useRef(branch.draftPrompt ?? "")

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Save draft to database
  const saveDraft = useCallback((branchId: string, draftPrompt: string) => {
    if (branchId.startsWith("temp-")) return // Don't save for temp branches being created

    // Skip if value hasn't changed from last save
    if (draftPrompt === lastSavedDraftRef.current) return

    lastSavedDraftRef.current = draftPrompt

    if (onSaveDraftForBranch) {
      onSaveDraftForBranch(branchId, draftPrompt)
    } else {
      fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, draftPrompt }),
      }).catch(() => {})
    }
  }, [onSaveDraftForBranch])

  // Debounced auto-save as user types
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Skip auto-save during branch creation
    if (branch.status === BRANCH_STATUS.CREATING) return

    // Set up debounced save
    debounceTimerRef.current = setTimeout(() => {
      saveDraft(branch.id, input)
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [input, branch.id, branch.status, saveDraft])

  // Save draft on unmount (e.g., when navigating away from the page entirely)
  useEffect(() => {
    return () => {
      // Clear any pending debounced save
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      // Save current draft immediately using sendBeacon for reliable delivery
      const currentInput = inputRef.current
      const currentBranchId = branchIdRef.current

      if (currentInput !== lastSavedDraftRef.current && !currentBranchId.startsWith("temp-")) {
        navigator.sendBeacon(
          "/api/branches/draft",
          new Blob(
            [JSON.stringify({ branchId: currentBranchId, draftPrompt: currentInput })],
            { type: "application/json" }
          )
        )
      }
    }
  }, []) // Empty deps - only runs on mount/unmount

  // Handle branch switches - save old draft, then load new draft
  useEffect(() => {
    const prevBranchId = prevBranchIdRef.current

    if (prevBranchId !== branch.id) {
      // Clear any pending debounced save for the old branch
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }

      const currentInput = inputRef.current
      // Client-created branches use a temporary id until the server returns the real one.
      // Same name + different id means an id handoff, not a sidebar branch switch.
      const isIdMigration =
        prevBranchNameRef.current === branch.name && prevBranchId !== branch.id

      // Save the current input to the OLD branch before a real branch switch (not id migration).
      // During id migration the old id is not valid server-side; draft was also skipped while CREATING.
      if (
        currentInput !== lastSavedDraftRef.current &&
        !prevBranchId.startsWith("temp-") &&
        !isIdMigration
      ) {
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

      // Load draft for the branch we're on. For id migration, keep local text if nothing was saved yet.
      const mergedDraft = isIdMigration
        ? (branch.draftPrompt ?? currentInput)
        : (branch.draftPrompt ?? "")
      setInput(mergedDraft)
      lastSavedDraftRef.current = mergedDraft

      // Persist under the real branch id — autosave was disabled while CREATING so DB never got the draft.
      if (
        isIdMigration &&
        mergedDraft !== "" &&
        !branch.id.startsWith("temp-")
      ) {
        if (onSaveDraftForBranch) {
          onSaveDraftForBranch(branch.id, mergedDraft)
        } else {
          fetch("/api/branches", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: branch.id, draftPrompt: mergedDraft }),
          }).catch(() => {})
        }
      }

      // Update refs to track the new branch
      prevBranchIdRef.current = branch.id
      branchIdRef.current = branch.id
      prevBranchNameRef.current = branch.name
    }
  }, [branch.id, branch.name, branch.draftPrompt, setInput, onSaveDraftForBranch])

  // Save draft on page unload/close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (branch.status === BRANCH_STATUS.CREATING) return
      const currentInput = inputRef.current
      if (currentInput && currentInput !== lastSavedDraftRef.current) {
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
  }, [branch.id, branch.status])

  return {
    input,
    setInput,
    inputRef,
    isNearBottomRef,
  }
}
