/**
 * File type detection utilities
 */

import { FileType, EXT_TO_LANG, CODE_EXTENSIONS, TEXT_EXTENSIONS, IMAGE_EXTENSIONS } from './types'

/**
 * Get the file extension from a filename or path
 */
export function getFileExtension(filenameOrPath: string): string {
  const name = filenameOrPath.split('/').pop()?.toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return name.slice(dot + 1)
}

/**
 * Get the base filename from a path
 */
export function getFilename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

/**
 * Detect the highlight.js language from a filename or path
 */
export function detectLang(filenameOrPath: string): string | null {
  const name = filenameOrPath.split('/').pop()?.toLowerCase() ?? ''

  // Special filenames
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'

  const ext = getFileExtension(name)
  if (!ext) return null

  return EXT_TO_LANG[ext] ?? null
}

/**
 * Determine the file type from a File object
 */
export function getFileType(file: File): FileType {
  const mimeType = file.type
  const ext = getFileExtension(file.name)

  // Images
  if (mimeType.startsWith('image/')) return 'image'

  // PDFs
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf'

  // Code files
  if (CODE_EXTENSIONS.includes(ext)) return 'code'

  // Text files
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) return 'text'

  return 'other'
}

/**
 * Determine the file type from a filename/path (for sandbox files)
 */
export function getFileTypeFromPath(filePath: string): FileType {
  const ext = getFileExtension(filePath)
  const name = getFilename(filePath).toLowerCase()

  // Special files that are code
  if (name === 'dockerfile' || name === 'makefile') return 'code'

  // Images (by extension)
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'

  // PDFs
  if (ext === 'pdf') return 'pdf'

  // Code files
  if (CODE_EXTENSIONS.includes(ext)) return 'code'

  // Text files
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'

  // Default to code for unknown extensions (most likely code in a sandbox)
  return 'code'
}

/**
 * Markdown file extensions
 */
const MARKDOWN_EXTENSIONS = ['md', 'mdx', 'markdown']

/**
 * Check if a file is a markdown file
 */
export function isMarkdownFile(file: File): boolean {
  const ext = getFileExtension(file.name)
  return MARKDOWN_EXTENSIONS.includes(ext)
}

/**
 * Check if a file path points to a markdown file
 */
export function isMarkdownPath(filePath: string): boolean {
  const ext = getFileExtension(filePath)
  return MARKDOWN_EXTENSIONS.includes(ext)
}
