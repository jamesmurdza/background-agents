"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/lib/hooks/useClickOutside"

// =============================================================================
// Branch Selector Component - Searchable dropdown for selecting git branches
// =============================================================================

export interface BranchSelectorProps {
  value: string
  onChange: (branch: string) => void
  branches: string[]
  loading: boolean
  placeholder?: string
  isMobile?: boolean
  /** Transform a branch name into a display label (e.g. resolve to chat name). */
  getLabel?: (branch: string) => string
  /** Called when dropdown open state changes */
  onOpenChange?: (open: boolean) => void
  /** Whether to auto-focus the input */
  autoFocus?: boolean
  /** Called when Enter is pressed while dropdown is closed (to submit the form) */
  onSubmit?: () => void
  /** Default value to show while loading */
  defaultValue?: string
}

export function BranchSelector({ value, onChange, branches, loading, placeholder = "Select chat", isMobile = false, getLabel, onOpenChange, autoFocus, onSubmit, defaultValue }: BranchSelectorProps) {
  const label = (b: string) => (getLabel ? getLabel(b) : b)
  const [open, setOpenState] = useState(false)
  const [search, setSearch] = useState("")
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Use defaultValue while loading, otherwise use value
  const displayValue = value || (loading ? defaultValue : "") || ""

  const setOpen = (newOpen: boolean) => {
    setOpenState(newOpen)
    onOpenChange?.(newOpen)
    if (newOpen) {
      setSearch("")
      setHighlightedIndex(0)
    }
  }

  // Filter branches by search
  const filteredBranches = branches.filter((branch) =>
    label(branch).toLowerCase().includes(search.toLowerCase())
  )

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const highlighted = listRef.current.querySelector('[data-highlighted="true"]')
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" })
      }
    }
  }, [highlightedIndex, open])

  // Close on click outside
  useClickOutside(containerRef, () => setOpen(false), open)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // When dropdown is closed:
      // - Enter submits the form (if value selected and onSubmit provided)
      // - ArrowDown/Space opens the dropdown (only if not loading)
      if (e.key === "Enter") {
        // Allow submit with displayValue (includes defaultValue while loading)
        if (displayValue && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
        // If no value selected and not loading, let Enter open the dropdown
        else if (!loading) {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      // Only allow opening dropdown if not loading
      if (!loading && (e.key === "ArrowDown" || e.key === " ")) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    // When dropdown is open
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredBranches.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (filteredBranches[highlightedIndex]) {
          onChange(filteredBranches[highlightedIndex])
          setOpen(false)
        }
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "w-full flex items-center bg-input border border-border rounded-md focus-within:ring-2 focus-within:ring-ring",
          isMobile ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"
        )}
      >
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={open ? search : (displayValue ? label(displayValue) : "")}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open && !loading) setOpen(true)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          readOnly={loading}
        />
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin ml-2 text-muted-foreground shrink-0" />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpen(!open)}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {open && !loading && (
        <div
          ref={listRef}
          className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredBranches.length === 0 ? (
            <div className={cn(
              "px-3 py-2 text-muted-foreground",
              isMobile ? "text-base" : "text-sm"
            )}>
              No matches found
            </div>
          ) : (
            filteredBranches.map((branch, index) => (
              <button
                key={branch}
                type="button"
                data-highlighted={index === highlightedIndex}
                onClick={() => {
                  onChange(branch)
                  setOpen(false)
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={cn(
                  "w-full text-left px-3 py-2 transition-colors",
                  isMobile ? "text-base" : "text-sm",
                  index === highlightedIndex ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                {label(branch)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
