"use client"

import { useCallback } from "react"
import { useRouter, usePathname, useParams } from "next/navigation"

/**
 * URL route patterns for the application
 */
export const ROUTES = {
  home: "/",
  chat: (chatId: string) => `/chat/${chatId}`,
  newChat: "/chat/new",
  jobs: "/jobs",
  job: (jobId: string) => `/jobs/${jobId}`,
  jobRun: (jobId: string, runId: string) => `/jobs/${jobId}/runs/${runId}`,
} as const

/**
 * Hook for URL-based navigation
 * Provides helpers for navigating between chats and other views
 */
export function useUrlNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()

  // Get current chat ID from URL params
  const chatIdFromUrl = params?.chatId as string | undefined

  // Get current job ID from URL params
  const jobIdFromUrl = params?.jobId as string | undefined

  // Get current run ID from URL params
  const runIdFromUrl = params?.runId as string | undefined

  // Check if we're on a specific route type
  const isOnChatRoute = pathname?.startsWith("/chat/") ?? false
  const isOnNewChatRoute = pathname === "/chat/new"
  const isOnJobsRoute = pathname?.startsWith("/jobs") ?? false
  const isOnHomeRoute = pathname === "/"

  // Navigate to a specific chat
  const navigateToChat = useCallback((chatId: string) => {
    router.push(ROUTES.chat(chatId))
  }, [router])

  // Navigate to new chat
  const navigateToNewChat = useCallback(() => {
    router.push(ROUTES.newChat)
  }, [router])

  // Navigate to jobs list
  const navigateToJobs = useCallback(() => {
    router.push(ROUTES.jobs)
  }, [router])

  // Navigate to a specific job
  const navigateToJob = useCallback((jobId: string) => {
    router.push(ROUTES.job(jobId))
  }, [router])

  // Navigate to a specific job run
  const navigateToJobRun = useCallback((jobId: string, runId: string) => {
    router.push(ROUTES.jobRun(jobId, runId))
  }, [router])

  // Navigate to home
  const navigateToHome = useCallback(() => {
    router.push(ROUTES.home)
  }, [router])

  // Replace current URL without adding to history
  const replaceChat = useCallback((chatId: string) => {
    router.replace(ROUTES.chat(chatId))
  }, [router])

  return {
    // Current route info
    chatIdFromUrl,
    jobIdFromUrl,
    runIdFromUrl,
    isOnChatRoute,
    isOnNewChatRoute,
    isOnJobsRoute,
    isOnHomeRoute,
    pathname,

    // Navigation functions
    navigateToChat,
    navigateToNewChat,
    navigateToJobs,
    navigateToJob,
    navigateToJobRun,
    navigateToHome,
    replaceChat,
  }
}
