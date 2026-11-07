/**
 * Placeholder shown while a scheduled job's detail page is loading, matching
 * JobRunDetail's actual header layout (title + run selector on the left,
 * actions menu on the right) instead of a generic "Loading..." string. The
 * content area below is left blank rather than faked — there's nothing
 * worth skeletonizing there until we know what the job even looks like.
 */
export function JobRunDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header — mirrors JobRunDetail's title/run-selector/actions row */}
      <div
        className="flex items-center justify-between pt-3 shrink-0 animate-pulse"
        style={{ paddingLeft: "1.625rem", paddingRight: "1rem" }}
      >
        <div className="flex items-center gap-2">
          <div className="h-7 w-40 rounded-md bg-muted" />
          <div className="h-7 w-32 rounded-md bg-muted" />
        </div>
        <div className="h-7 w-7 rounded-md bg-muted" />
      </div>

      <main className="flex-1" />
    </div>
  )
}
