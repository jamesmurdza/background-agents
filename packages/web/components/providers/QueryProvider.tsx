"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000, // 30 seconds
        gcTime: 5 * 60 * 1000, // 5 minutes
        retry: 2,
        // Re-sync server data when the user returns to a backgrounded tab, so a
        // long-idle window doesn't keep showing a stale chat list, statuses,
        // branches, or settings. staleTime gates this: queries fetched within
        // the last staleTime window are still "fresh" and are skipped, so quick
        // tab switches don't cause a refetch storm. Queries that manage their
        // own cadence (e.g. useServersQuery, which polls) opt out locally.
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always create a new query client
    return makeQueryClient()
  }
  // Browser: reuse client across renders
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Using useState ensures the client is created once per component instance
  // This is the recommended pattern for Next.js App Router
  const [queryClient] = useState(() => getQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
