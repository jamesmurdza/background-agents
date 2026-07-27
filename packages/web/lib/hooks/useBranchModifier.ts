"use client"

import { useEffect, useState } from "react"

/**
 * Tracks whether a "branch" modifier key (Cmd/Alt/Ctrl) is currently held.
 *
 * When it is — and branching is possible — the send button turns into a
 * "send to new branch" affordance (branch icon), and clicking it branches
 * instead of sending to the current chat. Mirrors the Cmd/Alt/Ctrl+Enter
 * keybinding.
 */
export function useBranchModifier(): boolean {
  const [branchModifierHeld, setBranchModifierHeld] = useState(false)
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      setBranchModifierHeld(e.metaKey || e.altKey || e.ctrlKey)
    }
    const clear = () => setBranchModifierHeld(false)
    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    // Reset when focus leaves the window so a stuck modifier doesn't persist.
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
      window.removeEventListener("blur", clear)
    }
  }, [])
  return branchModifierHeld
}
