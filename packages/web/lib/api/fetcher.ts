/**
 * Base fetch wrapper for TanStack Query
 *
 * Provides consistent error handling, type safety, and request configuration.
 */

import { ApiError } from "./errors"

interface FetchOptions extends RequestInit {
  timeout?: number
}

const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Type-safe fetch wrapper that throws ApiError on non-OK responses
 */
export async function apiFetch<T>(
  url: string,
  options?: FetchOptions
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options ?? {}

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...fetchOptions?.headers,
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      let errorData: { message?: string; code?: string } = {}
      try {
        errorData = await response.json()
      } catch {
        // Response might not be JSON
      }

      throw new ApiError(
        errorData.message || `Request failed with status ${response.status}`,
        response.status,
        errorData.code
      )
    }

    const text = await response.text()
    if (!text) {
      return {} as T
    }

    return JSON.parse(text) as T
  } catch (error) {
    clearTimeout(timeoutId)

    if (error instanceof ApiError) {
      throw error
    }

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new ApiError("Request timeout", 408, "TIMEOUT")
      }
      throw new ApiError(error.message, 0, "NETWORK_ERROR")
    }

    throw new ApiError("Unknown error occurred", 0, "UNKNOWN")
  }
}

/**
 * POST request helper
 */
export async function apiPost<T, B = unknown>(
  url: string,
  body: B,
  options?: Omit<FetchOptions, "method" | "body">
): Promise<T> {
  return apiFetch<T>(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(body),
  })
}

/**
 * PATCH request helper
 */
export async function apiPatch<T, B = unknown>(
  url: string,
  body: B,
  options?: Omit<FetchOptions, "method" | "body">
): Promise<T> {
  return apiFetch<T>(url, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body),
  })
}
