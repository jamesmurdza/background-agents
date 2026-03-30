/**
 * API Error class for consistent error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = "ApiError"

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError)
    }
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.status >= 500
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  /**
   * Check if this is a not found error
   */
  isNotFound(): boolean {
    return this.status === 404
  }

  /**
   * Check if this is a timeout error
   */
  isTimeout(): boolean {
    return this.status === 408 || this.code === "TIMEOUT"
  }

  /**
   * Check if this is a network error
   */
  isNetworkError(): boolean {
    return this.status === 0 || this.code === "NETWORK_ERROR"
  }
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * Get a user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.isAuthError()) {
      return "You need to sign in to continue."
    }
    if (error.isNotFound()) {
      return "The requested resource was not found."
    }
    if (error.isTimeout()) {
      return "The request timed out. Please try again."
    }
    if (error.isNetworkError()) {
      return "Network error. Please check your connection."
    }
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unexpected error occurred."
}
