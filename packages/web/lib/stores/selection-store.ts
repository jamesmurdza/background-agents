/**
 * Selection State Store using Zustand
 *
 * Manages active repo and branch selection state.
 */

import { create } from "zustand"
import { devtools } from "zustand/middleware"

interface SelectionState {
  activeRepoId: string | null
  activeBranchId: string | null
  initialSelectionDone: boolean
}

interface SelectionActions {
  setActiveRepoId: (repoId: string | null) => void
  setActiveBranchId: (branchId: string | null) => void
  selectRepo: (repoId: string, firstBranchId?: string | null) => void
  selectBranch: (branchId: string) => void
  updateActiveBranchId: (oldId: string, newId: string) => void
  markInitialSelectionDone: () => void
  resetSelection: () => void
}

const initialState: SelectionState = {
  activeRepoId: null,
  activeBranchId: null,
  initialSelectionDone: false,
}

export const useSelectionStore = create<SelectionState & SelectionActions>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setActiveRepoId: (repoId) =>
        set({ activeRepoId: repoId }, false, "setActiveRepoId"),

      setActiveBranchId: (branchId) =>
        set({ activeBranchId: branchId }, false, "setActiveBranchId"),

      selectRepo: (repoId, firstBranchId) =>
        set(
          { activeRepoId: repoId, activeBranchId: firstBranchId ?? null },
          false,
          "selectRepo"
        ),

      selectBranch: (branchId) =>
        set({ activeBranchId: branchId }, false, "selectBranch"),

      updateActiveBranchId: (oldId, newId) => {
        if (get().activeBranchId === oldId) {
          set({ activeBranchId: newId }, false, "updateActiveBranchId")
        }
      },

      markInitialSelectionDone: () =>
        set({ initialSelectionDone: true }, false, "markInitialSelectionDone"),

      resetSelection: () => set(initialState, false, "resetSelection"),
    }),
    { name: "selection-store" }
  )
)
