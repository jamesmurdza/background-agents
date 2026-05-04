"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import hljs from "highlight.js/lib/common"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface MarkdownPreviewProps {
  /** The markdown content to render */
  content: string
  /** Additional className for the container */
  className?: string
  /** Maximum height (CSS value, e.g., "65vh") */
  maxHeight?: string
}

/**
 * GitHub-style markdown preview component.
 * Renders markdown with GitHub Flavored Markdown support including:
 * - Tables, strikethrough, autolinks, task lists
 * - Syntax-highlighted code blocks with copy button
 * - Styled headings, blockquotes, lists, etc.
 */
export function MarkdownPreview({
  content,
  className = "",
  maxHeight,
}: MarkdownPreviewProps) {
  return (
    <div
      className={cn("overflow-auto", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <div className="github-markdown p-6 min-w-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Links
            a: ({ children, href, ...props }) => (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#0969da] dark:text-[#58a6ff] hover:underline"
              >
                {children}
              </a>
            ),

            // Paragraphs
            p: ({ children }) => (
              <p className="mt-0 mb-4 last:mb-0">{children}</p>
            ),

            // Lists
            ul: ({ children }) => (
              <ul className="mt-0 mb-4 pl-8 list-disc last:mb-0 [&_ul]:mb-0 [&_ol]:mb-0">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="mt-0 mb-4 pl-8 list-decimal last:mb-0 [&_ul]:mb-0 [&_ol]:mb-0">{children}</ol>
            ),
            li: ({ children, className }) => {
              // Handle task list items
              const isTaskItem = className?.includes("task-list-item")
              return (
                <li className={cn("mt-1", isTaskItem && "list-none ml-[-1.5rem]")}>
                  {children}
                </li>
              )
            },

            // Task list checkboxes
            input: ({ type, checked, ...props }) => {
              if (type === "checkbox") {
                return (
                  <input
                    {...props}
                    type="checkbox"
                    checked={checked}
                    disabled
                    className="mr-2 align-middle"
                  />
                )
              }
              return <input {...props} type={type} />
            },

            // Tables
            table: ({ children }) => (
              <div className="overflow-x-auto mb-4">
                <table className="border-collapse w-full">{children}</table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-[#f6f8fa] dark:bg-[#161b22]">{children}</thead>
            ),
            th: ({ children, style }) => (
              <th
                className="border border-[#d0d7de] dark:border-[#30363d] px-3 py-2 text-left font-semibold"
                style={style}
              >
                {children}
              </th>
            ),
            td: ({ children, style }) => (
              <td
                className="border border-[#d0d7de] dark:border-[#30363d] px-3 py-2"
                style={style}
              >
                {children}
              </td>
            ),

            // Code blocks
            pre: ({ children }) => (
              <CodeBlock>{children}</CodeBlock>
            ),

            // Headings
            h1: ({ children }) => (
              <h1 className="text-[2em] font-semibold pb-2 mb-4 border-b border-[#d0d7de] dark:border-[#30363d] leading-tight">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-[1.5em] font-semibold pb-2 mt-6 mb-4 border-b border-[#d0d7de] dark:border-[#30363d] leading-tight first:mt-0">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-[1.25em] font-semibold mt-6 mb-4 leading-tight first:mt-0">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-[1em] font-semibold mt-6 mb-4 leading-tight first:mt-0">
                {children}
              </h4>
            ),
            h5: ({ children }) => (
              <h5 className="text-[0.875em] font-semibold mt-6 mb-4 leading-tight first:mt-0">
                {children}
              </h5>
            ),
            h6: ({ children }) => (
              <h6 className="text-[0.85em] font-semibold mt-6 mb-4 leading-tight text-[#656d76] dark:text-[#848d97] first:mt-0">
                {children}
              </h6>
            ),

            // Blockquotes
            blockquote: ({ children }) => (
              <blockquote className="mt-0 mb-4 pl-4 border-l-4 border-[#d0d7de] dark:border-[#30363d] text-[#656d76] dark:text-[#848d97]">
                {children}
              </blockquote>
            ),

            // Horizontal rules
            hr: () => (
              <hr className="my-6 border-0 h-[0.25em] bg-[#d0d7de] dark:bg-[#30363d]" />
            ),

            // Text formatting
            strong: ({ children }) => (
              <strong className="font-semibold">{children}</strong>
            ),
            em: ({ children }) => (
              <em className="italic">{children}</em>
            ),
            del: ({ children }) => (
              <del className="line-through">{children}</del>
            ),

            // Inline code
            code: ({ children, className, ...props }) => {
              // Detect language from className (e.g., "language-typescript")
              const match = /language-(\w+)/.exec(className || "")
              const isBlock = !!match

              if (isBlock) {
                // Block code - will be wrapped in <pre> by CodeBlock
                const code = String(children).replace(/\n$/, "")
                const lang = match[1]

                let highlighted: string
                try {
                  if (hljs.getLanguage(lang)) {
                    highlighted = hljs.highlight(code, { language: lang }).value
                  } else {
                    highlighted = hljs.highlightAuto(code).value
                  }
                } catch {
                  highlighted = escapeHtml(code)
                }

                return (
                  <code
                    className="hljs-scope text-[13px] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                  />
                )
              }

              // Inline code
              return (
                <code
                  {...props}
                  className="px-[0.4em] py-[0.2em] rounded-md bg-[#afb8c133] dark:bg-[#6e768166] font-mono text-[85%]"
                >
                  {children}
                </code>
              )
            },

            // Images
            img: ({ src, alt, ...props }) => (
              <img
                {...props}
                src={src}
                alt={alt}
                className="max-w-full h-auto"
                loading="lazy"
              />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/**
 * Code block with copy button - GitHub style
 */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    // Extract text content from children (the code element)
    const codeElement = children as React.ReactElement<{ children?: string }>
    const textContent = codeElement?.props?.children || ""

    try {
      await navigator.clipboard.writeText(String(textContent))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <div className="relative group mb-4 last:mb-0">
      <pre className="overflow-x-auto rounded-md p-4 bg-[#f6f8fa] dark:bg-[#161b22] border border-[#d0d7de] dark:border-[#30363d]">
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md cursor-pointer",
          "opacity-0 group-hover:opacity-100 transition-all",
          "bg-[#f6f8fa] dark:bg-[#21262d] hover:bg-[#eaeef2] dark:hover:bg-[#30363d]",
          "border border-[#d0d7de] dark:border-[#30363d]",
          copied && "opacity-100"
        )}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-[#656d76] dark:text-[#848d97]" />
        )}
      </button>
    </div>
  )
}

/**
 * Escape HTML entities for safe rendering
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
