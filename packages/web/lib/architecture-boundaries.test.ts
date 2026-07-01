/**
 * Architecture boundary guard.
 *
 * The `@background-agents/claude-credentials` MAIN entry pulls in
 * @daytonaio/sdk -> @opentelemetry -> @grpc (Node-only). If it ever gets
 * imported from client-reachable code, the browser bundle breaks (historically
 * a cryptic gRPC error). Code that only needs the row-key constants must use
 * the zero-dep `@background-agents/claude-credentials/constants` subpath.
 *
 * This test fails if the heavy main entry is imported anywhere outside the
 * allowlist of genuinely server-only entrypoints, so the boundary is enforced
 * in CI instead of relying on a comment in next.config.ts.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, sep } from "node:path"

// Web package root (this file lives in <root>/lib/).
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// Files/dirs that are allowed to import the heavy main entry because they only
// ever run on the server (never bundled for the browser).
const ALLOWLIST = [
  // the single server-only orchestration module that reaches the generator
  join("lib", "server", "refresh-claude-credentials.ts"),
  "scripts", // node CLIs (seed:ccauth / test:ccauth)
]

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "e2e", // Playwright specs, not app code
])

function isAllowlisted(relPath: string): boolean {
  return ALLOWLIST.some(
    (allowed) => relPath === allowed || relPath.startsWith(allowed + sep),
  )
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectSourceFiles(join(dir, entry.name), acc)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      // Test files (incl. this one) are never shipped to the client.
      if (/\.test\.tsx?$/.test(entry.name)) continue
      acc.push(join(dir, entry.name))
    }
  }
  return acc
}

// Matches `from`/`import`/`require` referencing the EXACT bare specifier.
// The backreferenced closing quote can't sit right after the package name for
// the `/constants` subpath, so that safe import is intentionally not matched.
const HEAVY_IMPORT =
  /(?:from|import|require)\s*\(?\s*(['"])@background-agents\/claude-credentials\1/

describe("architecture boundaries", () => {
  it("only allowlisted server entrypoints import the heavy claude-credentials entry", () => {
    const offenders = collectSourceFiles(WEB_ROOT)
      .filter((abs) => HEAVY_IMPORT.test(readFileSync(abs, "utf8")))
      .map((abs) => relative(WEB_ROOT, abs))
      .filter((rel) => !isAllowlisted(rel))
      .sort()

    expect(
      offenders,
      offenders.length
        ? `These files import the heavy '@background-agents/claude-credentials' main entry ` +
            `(pulls in @daytonaio/sdk -> gRPC, Node-only). Import row-key constants from ` +
            `'@background-agents/claude-credentials/constants' instead, or add the file to ` +
            `the server-only allowlist if it genuinely never reaches the client:\n  ` +
            offenders.join("\n  ")
        : undefined,
    ).toEqual([])
  })
})
