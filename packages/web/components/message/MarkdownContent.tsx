"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import hljs from "highlight.js/lib/common"
import { cn } from "@/lib/utils"
import { CodeBlock } from "./CodeBlock"

interface MarkdownContentProps {
  text: string
  isMobile?: boolean
  constrainWidth?: boolean
}

export function MarkdownContent({ text, isMobile = false, constrainWidth = true }: MarkdownContentProps) {
  return (
    <div className={cn(
      "prose dark:prose-invert max-w-none w-full overflow-hidden min-w-0",
      // Spacing is controlled via component overrides below; prose-* utilities
      // here only set typography (leading, font-size). This avoids conflicts.
      "prose-p:leading-relaxed",
      "prose-li:leading-relaxed",
      "prose-headings:font-semibold",
      // Remove default prose margins; we apply explicit spacing below
      "prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-pre:my-0 prose-headings:my-0",
      // Make pre elements full width
      "prose-pre:w-full",
      // First/last child margin reset (handles edge cases)
      "[&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0",
      isMobile ? "prose-base" : "prose-sm prose-p:text-[15px] prose-li:text-[15px]"
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary break-words"
            >
              {children}
            </a>
          ),
          p: ({ children }) => (
            <p className={cn("mt-2 first:mt-0", constrainWidth && "max-w-[95%]")}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul className={cn("mt-2 first:mt-0 pl-5 list-disc space-y-0.5 [&_ul]:mt-1 [&_ol]:mt-1", constrainWidth && "max-w-[95%]")}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className={cn("mt-2 first:mt-0 pl-5 list-decimal space-y-0.5 [&_ul]:mt-1 [&_ol]:mt-1", constrainWidth && "max-w-[95%]")}>{children}</ol>
          ),
          li: ({ children }) => (
            <li>{children}</li>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mt-2 first:mt-0 max-w-full">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/50 px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          pre: ({ children }) => (
            <CodeBlock isMobile={isMobile}>{children}</CodeBlock>
          ),
          h1: ({ children }) => (
            <h1 className={cn("text-xl font-semibold mt-4 mb-2 first:mt-0", constrainWidth && "max-w-[95%]")}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className={cn("text-lg font-semibold mt-4 mb-2 first:mt-0", constrainWidth && "max-w-[95%]")}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className={cn("text-base font-semibold mt-3 mb-1.5 first:mt-0", constrainWidth && "max-w-[95%]")}>{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className={cn("text-sm font-semibold mt-3 mb-1 first:mt-0", constrainWidth && "max-w-[95%]")}>{children}</h4>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mt-2 first:mt-0 border-l-2 border-border pl-4 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr className="mt-4 mb-4 first:mt-0 border-t border-border" />
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          code: ({ children, className, ...props }) => {
            // Detect language from className (e.g., "language-typescript")
            const match = /language-(\w+)/.exec(className || "")
            const isBlock = !!match

            if (isBlock) {
              // Extract text content from children
              const code = String(children).replace(/\n$/, "")
              const lang = match[1]

              // Try to highlight with specified language, fall back to auto-detect
              let highlighted: string
              try {
                if (hljs.getLanguage(lang)) {
                  highlighted = hljs.highlight(code, { language: lang }).value
                } else {
                  highlighted = hljs.highlightAuto(code).value
                }
              } catch {
                highlighted = code
              }

              return (
                <code
                  className="hljs-scope text-[13px]"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              )
            }

            // Inline code: simple styling
            return (
              <code className="px-1 py-0.5 rounded bg-muted text-[13px] font-mono" {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
