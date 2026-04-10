#!/usr/bin/env bash
# Vercel "Ignored Build Step" hook for the monorepo.
#
# Usage (from a per-app vercel.json, with cwd at the package root):
#   bash ../../scripts/vercel-ignore.sh <app>
# where <app> is "web" or "simple-chat".
#
# Exit 0  -> skip the build (no relevant changes)
# Exit 1  -> proceed with the build
#
# An app is rebuilt when any of these changed since the previous commit:
#   * its own package directory
#   * any shared workspace package it depends on (agents, common)
#   * top-level files that affect every build (package.json, lockfile, tsconfig, scripts/)

set -eu

APP="${1:-}"
if [ -z "$APP" ]; then
  echo "vercel-ignore: missing app argument" >&2
  exit 1
fi

# Vercel always provides VERCEL_GIT_PREVIOUS_SHA on incremental builds. On the
# very first build for a project it is unset, in which case we must build.
PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$PREV" ]; then
  echo "vercel-ignore: no previous SHA, building."
  exit 1
fi

# Always rebuild on root config changes.
ROOT_PATHS=(
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "vercel.json"
  "scripts/"
)

# Per-app paths to watch.
case "$APP" in
  web)
    APP_PATHS=(
      "packages/web/"
      "packages/agents/"
      "packages/common/"
    )
    ;;
  simple-chat)
    APP_PATHS=(
      "packages/simple-chat/"
      "packages/agents/"
      "packages/common/"
    )
    ;;
  *)
    echo "vercel-ignore: unknown app '$APP'" >&2
    exit 1
    ;;
esac

WATCH=("${ROOT_PATHS[@]}" "${APP_PATHS[@]}")

# Run from the repo root so the paths above resolve.
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if git diff --quiet "$PREV" HEAD -- "${WATCH[@]}"; then
  echo "vercel-ignore: no changes affecting '$APP', skipping build."
  exit 0
fi

echo "vercel-ignore: changes detected for '$APP', building."
exit 1
