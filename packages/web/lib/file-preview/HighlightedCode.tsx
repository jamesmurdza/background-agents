"use client"

import { detectLang } from "./detect"
import { highlightCode } from "./highlight"

interface HighlightedCodeProps {
  /** The code content to highlight */
  code: string
  /** Filename or path (used for language detection) */
  filename: string
  /** Whether to show line numbers (default: true) */
  showLineNumbers?: boolean
  /** Additional className for the container */
  className?: string
  /** Maximum height (CSS value, e.g., "65vh") */
  maxHeight?: string
}

/**
 * Syntax-highlighted code viewer with line numbers.
 * Uses highlight.js for syntax highlighting and auto-detects language from filename.
 */
export function HighlightedCode({
  code,
  filename,
  showLineNumbers = true,
  className = "",
  maxHeight,
}: HighlightedCodeProps) {
  const lines = code.split("\n")
  const lang = detectLang(filename)

  const html = highlightCode(code, lang)

  const lineHtmls = html.split("\n")

  if (!showLineNumbers) {
    // Simple view without line numbers
    return (
      <div
        className={`overflow-auto hljs-scope ${className}`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <pre className="text-xs font-mono p-4 whitespace-pre-wrap break-all">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    )
  }

  // Table view with line numbers
  return (
    <div
      className={`overflow-auto hljs-scope ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((_, i) => (
            <tr key={i} className="leading-5">
              <td className="select-none text-right text-muted-foreground/50 pr-3 pl-3 align-top w-1 whitespace-nowrap">
                {i + 1}
              </td>
              <td
                className="pr-3 whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: lineHtmls[i] ?? "" }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
