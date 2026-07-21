"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { PreviewItem } from "@/components/PreviewView"
import type { Chat } from "@/lib/types"
import { basename } from "@/lib/format"

interface UsePreviewOptions {
  currentChat: Chat | null
  updateCurrentChat: (updates: Partial<Chat>) => void
  /**
   * Polled list of dev servers in the current sandbox. When a new server appears
   * we auto-open the preview pane to it — but only the *first* time a given port
   * shows up in this sandbox, not on every subsequent poll.
   */
  availableServers?: ReadonlyArray<{ port: number; url: string }>
}

interface UsePreviewResult {
  previewWidth: number
  setPreviewWidth: (width: number) => void
  isResizingPreview: boolean
  previewItems: PreviewItem[]
  activePreviewIndex: number
  previewItem: PreviewItem | null
  previewPaneHidden: boolean
  previewOpen: boolean
  getPreviewItemKey: (item: PreviewItem) => string
  openPreview: (item: PreviewItem) => void
  selectPreviewItem: (item: PreviewItem) => void
  closePreviewItem: (item: PreviewItem) => void
  closePreview: () => void
  showPreview: () => void
  startPreviewResize: (e: React.MouseEvent) => void
}

export function usePreview({ currentChat, updateCurrentChat, availableServers }: UsePreviewOptions): UsePreviewResult {
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === "undefined") return 520
    const stored = Number(window.localStorage.getItem("simple-chat-preview-width"))
    return Number.isFinite(stored) && stored >= 320 ? stored : 520
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("simple-chat-preview-width", String(Math.round(previewWidth)))
  }, [previewWidth])

  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const resizingPreview = useRef(false)

  // Preview state from chat
  const previewItems = (currentChat?.previewItems ?? []) as PreviewItem[]
  const activePreviewIndex = currentChat?.activePreviewIndex ?? 0
  const previewItem = previewItems[activePreviewIndex] ?? null
  const previewPaneHidden = currentChat?.previewPaneHidden ?? false
  const previewOpen = previewItems.length > 0 && !previewPaneHidden

  /** Get a unique key for a preview item */
  const getPreviewItemKey = useCallback((item: PreviewItem): string => {
    switch (item.type) {
      case "file": return `file:${item.filePath}`
      case "terminal": return `terminal:${item.id}`
      case "server": return `server:${item.port}`
    }
  }, [])

  /** Open a preview item - adds to list if not already present, switches to it if present */
  const openPreview = useCallback((next: PreviewItem) => {
    const existingIndex = previewItems.findIndex(
      (item) => getPreviewItemKey(item) === getPreviewItemKey(next)
    )
    if (existingIndex >= 0) {
      // Item already exists, just switch to it and unhide the pane
      updateCurrentChat({ activePreviewIndex: existingIndex, previewPaneHidden: false })
    } else {
      // Add new item, switch to it, and unhide the pane
      const newItems = [...previewItems, next]
      updateCurrentChat({
        previewItems: newItems,
        activePreviewIndex: newItems.length - 1,
        previewPaneHidden: false,
      })
    }
  }, [previewItems, getPreviewItemKey, updateCurrentChat])

  /** Select a specific preview item from the list */
  const selectPreviewItem = useCallback((item: PreviewItem) => {
    const index = previewItems.findIndex(
      (i) => getPreviewItemKey(i) === getPreviewItemKey(item)
    )
    if (index >= 0) {
      updateCurrentChat({ activePreviewIndex: index })
    }
  }, [previewItems, getPreviewItemKey, updateCurrentChat])

  /** Close a specific preview item from the list */
  const closePreviewItem = useCallback((item: PreviewItem) => {
    const index = previewItems.findIndex(
      (i) => getPreviewItemKey(i) === getPreviewItemKey(item)
    )
    if (index < 0) return

    const newItems = previewItems.filter((_, i) => i !== index)
    let newActiveIndex = activePreviewIndex

    if (newItems.length === 0) {
      // No items left, close the preview pane
      updateCurrentChat({
        previewItems: undefined,
        activePreviewIndex: undefined,
      })
    } else {
      // Adjust active index if needed
      if (index < activePreviewIndex) {
        newActiveIndex = activePreviewIndex - 1
      } else if (index === activePreviewIndex) {
        // If we closed the active item, select the previous one (or first if at start)
        newActiveIndex = Math.max(0, index - 1)
      }
      updateCurrentChat({
        previewItems: newItems,
        activePreviewIndex: newActiveIndex,
      })
    }
  }, [previewItems, activePreviewIndex, getPreviewItemKey, updateCurrentChat])

  /** Hide the preview pane (items are preserved, persisted to localStorage) */
  const closePreview = useCallback(() => {
    updateCurrentChat({ previewPaneHidden: true })
  }, [updateCurrentChat])

  /** Show the preview pane (unhide it, persisted to localStorage) */
  const showPreview = useCallback(() => {
    updateCurrentChat({ previewPaneHidden: false })
  }, [updateCurrentChat])

  const startPreviewResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingPreview.current = true
    setIsResizingPreview(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizingPreview.current) return
      const nextWidth = window.innerWidth - e.clientX
      // Clamp: keep the preview at least 320px wide, but also leave enough
      // room for the chat column on the left.
      const MIN_PREVIEW = 320
      const MIN_CHAT = 600
      const maxPreview = Math.max(MIN_PREVIEW, window.innerWidth - MIN_CHAT)
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(maxPreview, nextWidth)))
    }
    const up = () => {
      if (!resizingPreview.current) return
      resizingPreview.current = false
      setIsResizingPreview(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [])

  // Relative file links inside MarkdownPreview dispatch this CustomEvent to
  // ask us to open the linked file. Keeps the markdown component decoupled
  // from this hook — it doesn't need a callback prop threaded down to it.
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent<{ filePath: string }>).detail?.filePath
      if (!filePath) return
      const filename = basename(filePath)
      openPreview({ type: "file", filePath, filename })
    }
    window.addEventListener("open-preview-file", handler)
    return () => window.removeEventListener("open-preview-file", handler)
  }, [openPreview])

  // Track ports we've already auto-opened in each sandbox so the preview pane
  // only pops open the *first* time a new server appears — not every poll.
  const autoOpenedServersRef = useRef<Map<string, Set<number>>>(new Map())

  useEffect(() => {
    const sandboxId = currentChat?.sandboxId
    const chatId = currentChat?.id
    const servers = availableServers ?? []
    if (!sandboxId || servers.length === 0) return

    let seen = autoOpenedServersRef.current.get(sandboxId)
    if (!seen) {
      seen = new Set()
      autoOpenedServersRef.current.set(sandboxId, seen)
    }

    const newServer = servers.find((s) => !seen!.has(s.port))
    if (newServer) {
      servers.forEach((s) => seen!.add(s.port))
      if (chatId === currentChat?.id) {
        openPreview({ type: "server", port: newServer.port, url: newServer.url })
      }
    }
  }, [availableServers, currentChat?.sandboxId, currentChat?.id, openPreview])

  return {
    previewWidth,
    setPreviewWidth,
    isResizingPreview,
    previewItems,
    activePreviewIndex,
    previewItem,
    previewPaneHidden,
    previewOpen,
    getPreviewItemKey,
    openPreview,
    selectPreviewItem,
    closePreviewItem,
    closePreview,
    showPreview,
    startPreviewResize,
  }
}
