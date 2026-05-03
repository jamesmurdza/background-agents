"use client"

import { useEffect, useState, useRef } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDragToClose } from "@/lib/hooks/useDragToClose"

interface MobileBottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** Height of the sheet: 'auto' fits content, 'full' is 90vh, or specify a number in vh */
  height?: "auto" | "full" | number
  /** Show drag handle indicator (also enables swipe on handle to dismiss) */
  showDragHandle?: boolean
  /** Higher z-index to layer over other modals/drawers */
  elevated?: boolean
}

export function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
  height = "auto",
  showDragHandle = true,
  elevated = false,
}: MobileBottomSheetProps) {
  const { handlers, dragY, isDragging, dragRef } = useDragToClose({ onClose })

  // Calculate height style
  const heightStyle = height === "auto"
    ? { maxHeight: "85vh" }
    : height === "full"
    ? { height: "90vh" }
    : { height: `${height}vh` }

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/15 backdrop-blur-[1px] transition-opacity duration-300",
          elevated ? "z-[60]" : "z-50",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={dragRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 bg-popover rounded-t-2xl shadow-xl",
          elevated ? "z-[60]" : "z-50",
          !isDragging && "transition-transform duration-300 ease-out"
        )}
        style={{
          ...heightStyle,
          transform: open
            ? `translateY(${dragY}px)`
            : "translateY(100%)",
        }}
      >
        {/* Drag Handle */}
        {showDragHandle && (
          <div
            className="flex justify-center pt-3 pb-1"
            {...handlers}
          >
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
        )}

        {/* Header - also draggable to dismiss */}
        {title && (
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-border"
            {...handlers}
          >
            <h3 className="text-base font-semibold">{title}</h3>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg hover:bg-accent active:bg-accent transition-colors touch-target"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto mobile-scroll pb-safe" style={{ maxHeight: "calc(85vh - 60px)" }}>
          {children}
        </div>
      </div>
    </>
  )
}

// =============================================================================
// MobileSelect - A bottom sheet select component for mobile
// =============================================================================

interface MobileSelectOption {
  value: string
  label: string
  icon?: React.ReactNode
  description?: string
  disabled?: boolean
}

interface MobileSelectProps {
  open: boolean
  onClose: () => void
  title: string
  options: MobileSelectOption[]
  value: string
  onChange: (value: string) => void
}

export function MobileSelect({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
}: MobileSelectProps) {
  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    onClose()
  }

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={title}
      height="auto"
    >
      <div className="py-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => !option.disabled && handleSelect(option.value)}
            disabled={option.disabled}
            className={cn(
              "flex items-center gap-3 w-full px-4 py-4 text-left transition-colors touch-target",
              option.disabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-accent active:bg-accent",
              option.value === value && "bg-accent"
            )}
          >
            {option.icon && (
              <span className="shrink-0">{option.icon}</span>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">{option.label}</div>
              {option.description && (
                <div className="text-sm text-muted-foreground">{option.description}</div>
              )}
            </div>
            {option.value === value && (
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            )}
          </button>
        ))}
      </div>
    </MobileBottomSheet>
  )
}

// =============================================================================
// MobileRenameModal - A centered modal for renaming items
// =============================================================================

interface MobileRenameModalProps {
  open: boolean
  onClose: () => void
  title?: string
  initialValue: string
  onSave: (newValue: string) => void
  /** Placeholder text for the input */
  placeholder?: string
}

export function MobileRenameModal({
  open,
  onClose,
  title = "Rename",
  initialValue,
  onSave,
  placeholder = "Enter name",
}: MobileRenameModalProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset value when modal opens with new initialValue
  useEffect(() => {
    if (open) {
      setValue(initialValue)
      // Focus input after animation
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    }
  }, [open, initialValue])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  const handleSave = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== initialValue) {
      onSave(trimmed)
    }
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSave()
    } else if (e.key === "Escape") {
      onClose()
    }
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-sm bg-popover rounded-xl shadow-xl pointer-events-auto">
          {/* Header */}
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>

          {/* Content */}
          <div className="px-4 pb-4 space-y-4">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full px-3 py-2 text-base rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-base font-medium rounded-lg border border-border hover:bg-accent active:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!value.trim()}
                className="flex-1 px-4 py-2 text-base font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
