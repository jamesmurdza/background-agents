/**
 * Consistent focus ring styles for keyboard accessibility.
 * Use these classes on interactive elements to ensure visible focus indicators.
 */

/** Default focus ring - visible offset ring */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/** Inset focus ring - for elements where offset would look odd */
export const focusRingInset =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

/** Subtle focus ring - lighter ring for dense UIs */
export const focusRingSubtle =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"

/** Focus ring for dark backgrounds */
export const focusRingDark =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-background"

/**
 * Object containing all focus styles for easier selection
 */
export const focusStyles = {
  default: focusRing,
  inset: focusRingInset,
  subtle: focusRingSubtle,
  dark: focusRingDark,
} as const

export type FocusStyleType = keyof typeof focusStyles
