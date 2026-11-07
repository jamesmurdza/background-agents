/**
 * Animated placeholder shown while a scheduled job's detail page is loading,
 * matching JobRunDetail's actual header/content layout (title + run selector
 * on the left, actions menu on the right, message list below) instead of a
 * generic "Loading..." string.
 */
export function JobRunDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0 animate-pulse">
      {/* Header — mirrors JobRunDetail's title/run-selector/actions row */}
      <div
        className="flex items-center justify-between pt-3 shrink-0"
        style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}
      >
        <div className="flex items-center gap-2">
          <div className="h-7 w-40 rounded-md bg-muted" />
          <div className="h-7 w-32 rounded-md bg-muted" />
        </div>
        <div className="h-7 w-7 rounded-md bg-muted" />
      </div>

      {/* Content — a couple of message-shaped placeholder rows */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-24 rounded-md bg-muted" />
          <div className="h-16 w-2/3 rounded-md bg-muted" />
        </div>
      </main>
    </div>
  )
}
