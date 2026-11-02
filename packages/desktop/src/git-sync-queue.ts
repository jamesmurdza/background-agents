// =============================================================================
// Per-repo serial queue — never run two isomorphic-git ops on the same .git at
// once. Different repos run in parallel.
// =============================================================================

const repoQueues = new Map<string, Promise<unknown>>();

export function enqueue<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const prev = repoQueues.get(repo) ?? Promise.resolve();
  // Run `task` after the previous op settles, regardless of its outcome.
  const next = prev.then(task, task);
  // Swallow rejection on the chained promise so the queue keeps flowing.
  repoQueues.set(
    repo,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next as Promise<T>;
}
