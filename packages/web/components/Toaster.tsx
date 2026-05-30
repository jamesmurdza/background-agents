"use client"

import { useEffect } from "react"
import { GitBranch, X } from "lucide-react"
import { useToastStore, type Toast } from "@/lib/stores/toast-store"

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast)

  useEffect(() => {
    if (!toast.durationMs) return
    const id = setTimeout(() => removeToast(toast.id), toast.durationMs)
    return () => clearTimeout(id)
  }, [toast.id, toast.durationMs, removeToast])

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {toast.title}
        </div>
        {toast.body && (
          <div className="mt-0.5 break-words text-xs text-neutral-600 dark:text-neutral-400">
            {toast.body}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => removeToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
