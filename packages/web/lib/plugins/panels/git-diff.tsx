"use client"

import { useEffect, useState } from "react"
import hljs from "highlight.js/lib/common"
import { GitCompare, Loader2, ChevronDown, ChevronRight } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"
import type { DiffFile, Commit } from "@/lib/utils/diff-parser"

// Map file extensions to highlight.js language names
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", swift: "swift", scala: "scala",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp", php: "php",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini",
  md: "markdown", markdown: "markdown",
  sql: "sql", dockerfile: "dockerfile",
  r: "r", lua: "lua", pl: "perl", dart: "dart",
}

function detectLang(filePath: string): string | null {
  const name = filePath.split("/").pop()?.toLowerCase() ?? ""
  if (name === "dockerfile") return "dockerfile"
  if (name === "makefile") return "makefile"
  const dot = name.lastIndexOf(".")
  if (dot < 0) return null
  return EXT_TO_LANG[name.slice(dot + 1)] ?? null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function highlightCode(code: string, filePath: string): string {
  const lang = detectLang(filePath)
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

interface DiffResponse {
  baseBranch: string
  currentBranch: string
  commits: Commit[]
  files: DiffFile[]
  stats: {
    files: number
    insertions: number
    deletions: number
    commits: number
  }
}

function StatusBadge({ status }: { status: DiffFile["status"] }) {
  const labels: Record<DiffFile["status"], { text: string; className: string }> = {
    added: { text: "A", className: "text-green-600 dark:text-green-400" },
    deleted: { text: "D", className: "text-red-600 dark:text-red-400" },
    modified: { text: "M", className: "text-yellow-600 dark:text-yellow-400" },
    renamed: { text: "R", className: "text-blue-600 dark:text-blue-400" },
  }
  const { text, className } = labels[status]
  return <span className={`font-mono text-[10px] ${className}`}>{text}</span>
}

function FileDiff({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false)

  if (file.binary) {
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] mb-1">
          <StatusBadge status={file.status} />
          <span className="font-mono">{file.path}</span>
          <span className="text-muted-foreground/60">(binary)</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-muted-foreground text-[11px] mb-1 hover:text-foreground transition-colors w-full text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        <StatusBadge status={file.status} />
        <span className="font-mono truncate">{file.path}</span>
        <span className="text-muted-foreground/60 ml-auto shrink-0">
          +{file.additions} -{file.deletions}
        </span>
      </button>

      {!collapsed && (
        <div className="border-l-2 border-border pl-2 ml-1">
          <table className="w-full text-xs font-mono border-collapse hljs-scope">
            <tbody>
              {file.hunks.map((hunk, hunkIdx) => (
                <tr key={hunkIdx}>
                  <td colSpan={3} className="pt-2 pb-1">
                    {hunk.lines.map((line, lineIdx) => {
                      if (line.type === "header") {
                        return (
                          <div
                            key={lineIdx}
                            className="text-muted-foreground/60 text-[10px] py-0.5"
                          >
                            {line.content}
                          </div>
                        )
                      }

                      const bgClass =
                        line.type === "addition"
                          ? "diff-line-addition"
                          : line.type === "deletion"
                            ? "diff-line-deletion"
                            : ""

                      const prefix =
                        line.type === "addition"
                          ? "+"
                          : line.type === "deletion"
                            ? "-"
                            : " "

                      const highlighted = highlightCode(line.content, file.path)

                      return (
                        <div
                          key={lineIdx}
                          className={`flex leading-5 ${bgClass}`}
                        >
                          <span className="select-none text-muted-foreground/40 w-8 text-right pr-1 shrink-0">
                            {line.oldLine ?? ""}
                          </span>
                          <span className="select-none text-muted-foreground/40 w-8 text-right pr-2 shrink-0">
                            {line.newLine ?? ""}
                          </span>
                          <span className="select-none text-muted-foreground/60 w-4 shrink-0">
                            {prefix}
                          </span>
                          <span
                            className="whitespace-pre-wrap break-all"
                            dangerouslySetInnerHTML={{ __html: highlighted }}
                          />
                        </div>
                      )
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CommitList({ commits }: { commits: Commit[] }) {
  const [expanded, setExpanded] = useState(false)

  if (commits.length === 0) return null

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span>{commits.length} commit{commits.length !== 1 ? "s" : ""}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 text-xs font-mono">
          {commits.map((commit) => (
            <div key={commit.sha} className="flex items-baseline gap-2 text-muted-foreground">
              <span className="text-primary/70 shrink-0">{commit.shortSha}</span>
              <span className="truncate">{commit.message}</span>
              <span className="text-muted-foreground/50 shrink-0 ml-auto">{commit.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GitDiffComponent({ item, sandboxId }: PanelProps) {
  const [data, setData] = useState<DiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const baseBranch = item.type === "git-diff" ? item.baseBranch : ""

  useEffect(() => {
    if (!sandboxId) {
      setError("No sandbox.")
      setLoading(false)
      return
    }
    if (!baseBranch) {
      setError("No base branch.")
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch("/api/sandbox/git-diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId, baseBranch }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || "Failed to load diff")
          setData(null)
        } else {
          setData(json as DiffResponse)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sandboxId, baseBranch])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 p-4 text-sm text-destructive">
        <div>{error}</div>
      </div>
    )
  }

  if (!data || (data.files.length === 0 && data.commits.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 p-4 text-sm text-muted-foreground">
        <div>No changes</div>
        <div className="text-xs text-muted-foreground/60">
          Branch is up to date with {baseBranch}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3">
      {/* Stats header */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
        <span>{data.stats.commits} commit{data.stats.commits !== 1 ? "s" : ""}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-green-600 dark:text-green-400">+{data.stats.insertions}</span>
        <span className="text-red-600 dark:text-red-400">-{data.stats.deletions}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{data.stats.files} file{data.stats.files !== 1 ? "s" : ""}</span>
      </div>

      {/* Commits (collapsible) */}
      <CommitList commits={data.commits} />

      {/* File diffs */}
      {data.files.map((file, idx) => (
        <FileDiff key={`${file.path}-${idx}`} file={file} />
      ))}
    </div>
  )
}

export const GitDiffPlugin: PanelPlugin = {
  id: "git-diff",

  canHandle: (item: PreviewItem) => item.type === "git-diff",

  getLabel: (item: PreviewItem) => {
    if (item.type === "git-diff") {
      return `Diff vs ${item.baseBranch}`
    }
    return "Diff"
  },

  getIcon: () => GitCompare,

  Component: GitDiffComponent,
}
