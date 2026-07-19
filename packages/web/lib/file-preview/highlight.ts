import hljs from "highlight.js/lib/common"
import { escapeHtml } from "@/lib/html"

/**
 * Syntax-highlight code to an HTML string using highlight.js.
 *
 * When a known language is provided it is used directly; otherwise the
 * language is auto-detected. If highlighting throws (e.g. malformed input),
 * the escaped code is returned so the caller can safely render it.
 *
 * @param code - The source code to highlight
 * @param lang - Optional language hint (e.g. "typescript")
 * @returns Highlighted HTML (or escaped code on failure)
 */
export function highlightCode(code: string, lang?: string | null): string {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}
