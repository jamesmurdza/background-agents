"use client"

import { cn } from "@/lib/shared/utils"

interface NoticeIconProps {
  className?: string
}

/**
 * Warning icon - Triangle with exclamation mark
 * Noun project style: simple, clean line art
 */
export function WarningIcon({ className }: NoticeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path
        d="M12 9v4m0 4h.01M10.615 3.892 2.39 18.098c-.456.788-.684 1.182-.65 1.506a1 1 0 0 0 .406.705c.263.191.718.191 1.629.191h16.45c.91 0 1.365 0 1.628-.191a1 1 0 0 0 .407-.705c.034-.324-.195-.718-.65-1.506L13.383 3.892c-.454-.785-.681-1.178-.978-1.31a1 1 0 0 0-.81 0c-.297.132-.524.525-.979 1.31Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Success icon - Circle with checkmark
 * Noun project style: simple, clean line art
 */
export function SuccessIcon({ className }: NoticeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path
        d="m9 12 2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Info icon - Circle with "i"
 * Noun project style: simple, clean line art
 */
export function InfoIcon({ className }: NoticeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path
        d="M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Error icon - Circle with X
 * Noun project style: simple, clean line art
 */
export function ErrorIcon({ className }: NoticeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path
        d="m15 9-6 6m0-6 6 6m7-3a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export type NoticeIconType = "warning" | "success" | "info" | "error"

/**
 * Helper function to get the icon component for a notice type
 */
export function NoticeIcon({ type, className }: { type: NoticeIconType; className?: string }) {
  switch (type) {
    case "warning":
      return <WarningIcon className={className} />
    case "success":
      return <SuccessIcon className={className} />
    case "info":
      return <InfoIcon className={className} />
    case "error":
      return <ErrorIcon className={className} />
    default:
      return <InfoIcon className={className} />
  }
}
