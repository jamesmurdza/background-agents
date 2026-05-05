/**
 * useFileUpload - Custom hook for file upload management
 *
 * Handles file validation, drag-and-drop, paste, and preview functionality.
 * Extracted from ChatPanel.tsx to reduce component complexity.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import { nanoid } from "nanoid"
import { getFileType } from "@/lib/file-preview"
import type { PendingFile } from "@/lib/types"

// File upload constraints
const MAX_FILE_SIZE = 30 * 1024 * 1024 // 30 MB
const MAX_FILE_COUNT = 20
const MAX_IMAGE_DIMENSION = 8000 // 8000 x 8000 pixels

const SUPPORTED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // Documents
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'text/html',
  'text/rtf',
  'application/rtf',
  'application/epub+zip',
]

const SUPPORTED_EXTENSIONS = [
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  // Documents
  'pdf', 'docx', 'txt', 'csv', 'tsv', 'html', 'htm', 'rtf', 'epub',
  // Code & config files
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'swift', 'kt', 'scala',
  'sh', 'bash', 'zsh', 'ps1', 'sql', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
  'md', 'mdx', 'graphql', 'gql', 'prisma', 'proto',
  'dockerfile', 'makefile', 'cmake', 'gradle', 'properties', 'plist', 'lock',
  'gitignore', 'dockerignore', 'editorconfig', 'eslintrc', 'prettierrc', 'babelrc', 'npmrc', 'nvmrc', 'log',
]

interface UseFileUploadOptions {
  /** Callback that fires when sign-in is required before adding files */
  onRequireSignIn?: () => void
}

interface UseFileUploadReturn {
  /** Currently pending files waiting to be sent */
  pendingFiles: PendingFile[]
  /** Whether user is dragging files over the drop zone */
  isDraggingOver: boolean
  /** Currently previewing file (for modal) */
  previewFile: PendingFile | null
  /** Map of file ID to text content (for text/code files) */
  fileContents: Map<string, string>
  /** Current error message, if any */
  fileError: string | null
  /** Ref for hidden file input element */
  fileInputRef: React.RefObject<HTMLInputElement | null>
  /** Add files (validates and adds to pending list) */
  addFiles: (files: FileList | File[]) => Promise<void>
  /** Remove a file from pending list by ID */
  removeFile: (id: string) => void
  /** Clear all pending files */
  clearFiles: () => void
  /** Clear the error message */
  clearError: () => void
  /** Set the preview file (for modal) */
  setPreviewFile: (file: PendingFile | null) => void
  /** Handler for drag over events */
  handleDragOver: (e: React.DragEvent) => void
  /** Handler for drag leave events */
  handleDragLeave: (e: React.DragEvent) => void
  /** Handler for drop events */
  handleDrop: (e: React.DragEvent) => void
  /** Handler for paste events (images from clipboard) */
  handlePaste: (e: React.ClipboardEvent) => void
  /** Get the file type for a file */
  getFileTypeForFile: (file: File) => ReturnType<typeof getFileType>
  /** Get a preview URL for image/PDF files */
  getFilePreviewUrl: (file: File) => string | null
  /** Supported extensions for file input accept attribute */
  supportedExtensions: string[]
}

/**
 * Helper to check if file type is supported
 */
function isFileTypeSupported(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return SUPPORTED_MIME_TYPES.includes(file.type) || SUPPORTED_EXTENSIONS.includes(ext)
}

/**
 * Helper to validate image dimensions (async, returns promise)
 */
function validateImageDimensions(file: File): Promise<{ valid: boolean; width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve({ valid: true })
      return
    }

    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({
        valid: img.width <= MAX_IMAGE_DIMENSION && img.height <= MAX_IMAGE_DIMENSION,
        width: img.width,
        height: img.height,
      })
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ valid: true }) // Allow if we can't check
    }

    img.src = url
  })
}

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const { onRequireSignIn } = options

  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [previewFile, setPreviewFile] = useState<PendingFile | null>(null)
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map())
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Read text file contents for preview
   */
  const readFileContent = useCallback((file: File, fileId: string) => {
    const type = getFileType(file)
    if (type === 'text' || type === 'code') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setFileContents(prev => new Map(prev).set(fileId, content))
      }
      reader.readAsText(file)
    }
  }, [])

  /**
   * Add files to the pending list with validation
   */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    // Clear previous errors
    setFileError(null)

    // Require sign-in before adding files (files can't persist across OAuth redirect)
    if (onRequireSignIn) {
      onRequireSignIn()
      return
    }

    const fileArray = Array.from(files)
    const errors: string[] = []
    const validFiles: File[] = []

    // Check file count limit
    const currentCount = pendingFiles.length
    const availableSlots = MAX_FILE_COUNT - currentCount

    if (fileArray.length > availableSlots) {
      if (availableSlots <= 0) {
        setFileError(`Maximum ${MAX_FILE_COUNT} files allowed per message`)
        return
      }
      errors.push(`Only ${availableSlots} more file(s) can be added (max ${MAX_FILE_COUNT})`)
      fileArray.splice(availableSlots) // Only process files that fit
    }

    // Validate each file
    for (const file of fileArray) {
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" exceeds 30 MB limit`)
        continue
      }

      // Check file type
      if (!isFileTypeSupported(file)) {
        errors.push(`"${file.name}" is not a supported file type`)
        continue
      }

      // Check image dimensions
      if (file.type.startsWith('image/')) {
        const dimCheck = await validateImageDimensions(file)
        if (!dimCheck.valid) {
          errors.push(`"${file.name}" exceeds 8000x8000 pixel limit (${dimCheck.width}x${dimCheck.height})`)
          continue
        }
      }

      validFiles.push(file)
    }

    // Show errors if any
    if (errors.length > 0) {
      setFileError(errors.join('. '))
    }

    // Add valid files
    if (validFiles.length > 0) {
      const newFiles: PendingFile[] = validFiles.map(file => ({
        id: nanoid(),
        file,
        name: file.name,
        size: file.size,
      }))
      setPendingFiles(prev => [...prev, ...newFiles])
    }
  }, [onRequireSignIn, pendingFiles.length])

  /**
   * Remove a file from the pending list
   */
  const removeFile = useCallback((id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  /**
   * Clear all pending files
   */
  const clearFiles = useCallback(() => {
    setPendingFiles([])
    setFileError(null)
  }, [])

  /**
   * Clear the error message
   */
  const clearError = useCallback(() => {
    setFileError(null)
  }, [])

  /**
   * Handle drag over events
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }, [])

  /**
   * Handle drag leave events
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }, [])

  /**
   * Handle drop events
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }, [addFiles])

  /**
   * Handle paste from clipboard (for images)
   */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      // Check if the item is an image
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          // Generate a name for pasted images since they don't have one
          const extension = item.type.split('/')[1] || 'png'
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const namedFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
            type: file.type,
          })
          imageFiles.push(namedFile)
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault() // Prevent pasting image data as text
      addFiles(imageFiles)
    }
  }, [addFiles])

  /**
   * Get file preview URL for image/PDF files
   */
  const getFilePreviewUrl = useCallback((file: File): string | null => {
    const type = getFileType(file)
    if (type === 'image' || type === 'pdf') {
      return URL.createObjectURL(file)
    }
    return null
  }, [])

  // Read file contents when files are added
  useEffect(() => {
    pendingFiles.forEach(pf => {
      if (!fileContents.has(pf.id)) {
        readFileContent(pf.file, pf.id)
      }
    })
  }, [pendingFiles, fileContents, readFileContent])

  // Clean up object URLs when component unmounts
  useEffect(() => {
    return () => {
      pendingFiles.forEach(pf => {
        const type = getFileType(pf.file)
        if (type === 'image' || type === 'pdf') {
          URL.revokeObjectURL(URL.createObjectURL(pf.file))
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    pendingFiles,
    isDraggingOver,
    previewFile,
    fileContents,
    fileError,
    fileInputRef,
    addFiles,
    removeFile,
    clearFiles,
    clearError,
    setPreviewFile,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    getFileTypeForFile: getFileType,
    getFilePreviewUrl,
    supportedExtensions: SUPPORTED_EXTENSIONS,
  }
}
