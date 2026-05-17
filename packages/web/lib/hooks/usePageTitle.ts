"use client"

import { useEffect } from "react"
import { formatPageTitle } from "@/lib/config"

/**
 * Hook to dynamically update the page title
 *
 * @param parts - Title parts to include (filtered for null/undefined)
 *
 * @example
 * // Sets title to "My Chat · Background Agents"
 * usePageTitle("My Chat")
 *
 * @example
 * // Sets title to "Background Agents" when chat has no name
 * usePageTitle(chat?.displayName)
 */
export function usePageTitle(...parts: (string | null | undefined)[]) {
  useEffect(() => {
    document.title = formatPageTitle(...parts)
  }, [parts.join("|")]) // eslint-disable-line react-hooks/exhaustive-deps
}
