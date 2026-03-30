"use client"

import { SessionProvider } from "next-auth/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useState } from "react"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data considered fresh for 30 seconds
        staleTime: 30 * 1000,
        // Keep in cache for 5 minutes after unmount
        gcTime: 5 * 60 * 1000,
        // Retry failed requests 3 times
        retry: 3,
        // Refetch on window focus
        refetchOnWindowFocus: true,
        // Refetch on mount if stale
        refetchOnMount: true,
      },
      mutations: {
        // Retry mutations once
        retry: 1,
      },
    },
  })
}

// Browser-side query client singleton
let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always create a new query client
    return makeQueryClient()
  } else {
    // Browser: use singleton pattern
    if (!browserQueryClient) {
      browserQueryClient = makeQueryClient()
    }
    return browserQueryClient
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        {children}
      </SessionProvider>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
