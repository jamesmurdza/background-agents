"use client"

/**
 * Unified Dropdown Components
 *
 * A consistent dropdown system for both desktop and mobile:
 * - DesktopDropdown: Standard dropdown menu for desktop
 * - ResponsiveDropdown: Auto-switches between desktop dropdown and mobile bottom sheet
 *
 * Usage:
 *   <ResponsiveDropdown
 *     options={[{ value: 'a', label: 'Option A' }]}
 *     value="a"
 *     onChange={(v) => console.log(v)}
 *     trigger={<button>Select</button>}
 *     title="Select Option"
 *     isMobile={isMobile}
 *   />
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { MobileSelect } from "./MobileBottomSheet"

// =============================================================================
// Types
// =============================================================================

export interface DropdownOption {
  value: string
  label: string
  icon?: ReactNode
  description?: string
  disabled?: boolean
  /** Additional content to show on the right side */
  suffix?: ReactNode
}

interface DropdownBaseProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  /** Custom trigger element - if not provided, uses default button with label */
  trigger?: ReactNode
  /** Title shown in mobile sheet header */
  title?: string
  /** Position of dropdown relative to trigger */
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right"
  /** Width of dropdown menu */
  width?: number | "auto" | "trigger"
  /** Additional class names for the dropdown menu */
  menuClassName?: string
  /** Additional class names for the container */
  className?: string
  /** ID for testing */
  testId?: string
}

interface DesktopDropdownProps extends DropdownBaseProps {
  /** Controlled open state (optional) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ResponsiveDropdownProps extends DropdownBaseProps {
  isMobile: boolean
}

// =============================================================================
// DesktopDropdown - Standard dropdown menu for desktop
// =============================================================================

export function DesktopDropdown({
  options,
  value,
  onChange,
  trigger,
  position = "bottom-right",
  width = "auto",
  menuClassName,
  className,
  testId,
  open: controlledOpen,
  onOpenChange,
}: DesktopDropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Support both controlled and uncontrolled modes
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen

  const setOpen = useCallback((newOpen: boolean) => {
    if (isControlled) {
      onOpenChange?.(newOpen)
    } else {
      setInternalOpen(newOpen)
    }
  }, [isControlled, onOpenChange])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [isOpen, setOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [isOpen, setOpen])

  const handleSelect = (optionValue: string) => {
    onChange(optionValue)
    setOpen(false)
  }

  const selectedOption = options.find(o => o.value === value)

  // Position classes
  const positionClasses = {
    "bottom-left": "top-full left-0 mt-1",
    "bottom-right": "top-full right-0 mt-1",
    "top-left": "bottom-full left-0 mb-1",
    "top-right": "bottom-full right-0 mb-1",
  }

  // Width style
  const widthStyle = width === "auto"
    ? {}
    : width === "trigger"
    ? { minWidth: "100%" }
    : { width: `${width}px` }

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      data-dropdown
      data-testid={testId}
    >
      {/* Trigger */}
      <div
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!isOpen)
        }}
      >
        {trigger ?? (
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {selectedOption?.icon}
            <span>{selectedOption?.label ?? "Select..."}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 bg-popover border border-border rounded-md shadow-lg py-1 max-h-64 overflow-y-auto",
            positionClasses[position],
            menuClassName
          )}
          style={widthStyle}
        >
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => !option.disabled && handleSelect(option.value)}
              disabled={option.disabled}
              className={cn(
                "w-full text-left transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                option.disabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-accent active:bg-accent",
                option.value === value && "bg-accent"
              )}
            >
              {option.icon && <span className="shrink-0">{option.icon}</span>}
              <span className="flex-1 min-w-0 truncate">{option.label}</span>
              {option.suffix && <span className="shrink-0">{option.suffix}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// ResponsiveDropdown - Auto-switches between desktop and mobile
// =============================================================================

export function ResponsiveDropdown({
  options,
  value,
  onChange,
  trigger,
  title = "Select",
  position = "bottom-right",
  width = "auto",
  menuClassName,
  className,
  testId,
  isMobile,
}: ResponsiveDropdownProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  // Convert options to MobileSelect format
  const mobileOptions = options.map(opt => ({
    value: opt.value,
    label: opt.label,
    icon: opt.icon,
    description: opt.description,
    disabled: opt.disabled,
  }))

  if (isMobile) {
    return (
      <>
        <div
          onClick={() => setMobileOpen(true)}
          className={className}
          data-testid={testId}
        >
          {trigger}
        </div>
        <MobileSelect
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          title={title}
          options={mobileOptions}
          value={value}
          onChange={onChange}
        />
      </>
    )
  }

  return (
    <DesktopDropdown
      options={options}
      value={value}
      onChange={onChange}
      trigger={trigger}
      position={position}
      width={width}
      menuClassName={menuClassName}
      className={className}
      testId={testId}
    />
  )
}

// =============================================================================
// Convenience exports
// =============================================================================

export type { DropdownBaseProps, DesktopDropdownProps, ResponsiveDropdownProps }
