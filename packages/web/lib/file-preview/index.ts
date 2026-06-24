/**
 * Unified file preview library
 *
 * This module provides shared components and utilities for previewing files
 * across different contexts (uploaded files in chat, sidebar file viewer, etc.)
 */

// Types and utilities
export { formatFileSize } from './types'

// Detection utilities
export {
  getFileType,
  getFileTypeFromPath,
  isMarkdownPath,
} from './detect'

// Code/text preview components
export { HighlightedCode } from './HighlightedCode'

// Markdown preview component
export { MarkdownPreview } from './MarkdownPreview'

// Image preview components
export { ImageThumbnail, ImageFullPreview } from './ImagePreview'

// PDF preview components
export { PdfThumbnail, PdfFullPreview } from './PdfPreview'

// Text thumbnail component
export { TextThumbnail } from './TextThumbnail'
