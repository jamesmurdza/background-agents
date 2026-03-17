"use client"

import { useState, useCallback, useEffect } from "react"
import { Loader2, AlertTriangle, Check, FileWarning, ArrowRight, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"

// Types for conflict data
export interface ConflictFile {
  path: string
  oursContent: string
  theirsContent: string
  baseContent: string
  conflictMarkers: string
}

export interface MergeConflictData {
  hasConflicts: boolean
  conflictFiles: ConflictFile[]
  currentBranch: string
  targetBranch: string
  message: string
}

interface MergeConflictModalProps {
  open: boolean
  onClose: () => void
  conflictData: MergeConflictData | null
  sandboxId: string
  repoPath: string
  repoName: string
  onResolved: (message: string) => void
  onAborted: () => void
}

type ResolutionChoice = "ours" | "theirs" | "custom"

interface FileResolution {
  path: string
  choice: ResolutionChoice
  customContent?: string
  resolved: boolean
}

export function MergeConflictModal({
  open,
  onClose,
  conflictData,
  sandboxId,
  repoPath,
  repoName,
  onResolved,
  onAborted,
}: MergeConflictModalProps) {
  const [resolutions, setResolutions] = useState<Map<string, FileResolution>>(new Map())
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [customEditing, setCustomEditing] = useState(false)
  const [customContent, setCustomContent] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Initialize resolutions when conflict data changes
  useEffect(() => {
    if (conflictData?.conflictFiles) {
      const initial = new Map<string, FileResolution>()
      conflictData.conflictFiles.forEach((file) => {
        initial.set(file.path, {
          path: file.path,
          choice: "ours",
          resolved: false,
        })
      })
      setResolutions(initial)
      setCurrentFileIndex(0)
      setCustomEditing(false)
      setError(null)
    }
  }, [conflictData])

  const currentFile = conflictData?.conflictFiles[currentFileIndex]
  const currentResolution = currentFile ? resolutions.get(currentFile.path) : undefined
  const resolvedCount = Array.from(resolutions.values()).filter((r) => r.resolved).length
  const totalFiles = conflictData?.conflictFiles.length || 0

  const handleChoiceChange = useCallback((choice: ResolutionChoice) => {
    if (!currentFile) return
    setResolutions((prev) => {
      const next = new Map(prev)
      next.set(currentFile.path, {
        ...next.get(currentFile.path)!,
        choice,
        customContent: choice === "custom" ? (next.get(currentFile.path)?.customContent || currentFile.conflictMarkers) : undefined,
      })
      return next
    })
    if (choice === "custom") {
      setCustomContent(resolutions.get(currentFile.path)?.customContent || currentFile.conflictMarkers)
      setCustomEditing(true)
    } else {
      setCustomEditing(false)
    }
  }, [currentFile, resolutions])

  const handleResolveFile = useCallback(async () => {
    if (!currentFile || !currentResolution) return
    setLoading(true)
    setError(null)

    try {
      const resolution = currentResolution.choice
      const body: Record<string, unknown> = {
        sandboxId,
        repoPath,
        action: "resolve-file",
        filePath: currentFile.path,
        resolution,
      }

      if (resolution === "custom") {
        body.resolvedContent = customContent
      }

      const res = await fetch("/api/sandbox/merge-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to resolve file")

      // Mark as resolved
      setResolutions((prev) => {
        const next = new Map(prev)
        next.set(currentFile.path, {
          ...next.get(currentFile.path)!,
          resolved: true,
          customContent: resolution === "custom" ? customContent : undefined,
        })
        return next
      })

      // Move to next unresolved file
      const allFiles = conflictData?.conflictFiles || []
      const nextUnresolved = allFiles.findIndex((f, i) => {
        if (i <= currentFileIndex) return false
        const r = resolutions.get(f.path)
        return !r?.resolved
      })

      if (nextUnresolved !== -1) {
        setCurrentFileIndex(nextUnresolved)
      }

      setCustomEditing(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resolve file")
    } finally {
      setLoading(false)
    }
  }, [currentFile, currentResolution, sandboxId, repoPath, customContent, conflictData, currentFileIndex, resolutions])

  const handleCompleteMerge = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/sandbox/merge-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "complete-merge",
          currentBranch: conflictData?.currentBranch,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to complete merge")

      onResolved(data.message || `Merged ${conflictData?.currentBranch} into ${conflictData?.targetBranch}`)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to complete merge")
    } finally {
      setLoading(false)
    }
  }, [sandboxId, repoPath, conflictData, onResolved, onClose])

  const handleAbort = useCallback(async () => {
    setLoading(true)
    try {
      await fetch("/api/sandbox/merge-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath,
          action: "abort-merge",
          currentBranch: conflictData?.currentBranch,
        }),
      })
      onAborted()
      onClose()
    } catch {
      // Ignore errors on abort
      onClose()
    } finally {
      setLoading(false)
    }
  }, [sandboxId, repoPath, conflictData, onAborted, onClose])

  const allResolved = resolvedCount === totalFiles

  if (!conflictData || !currentFile) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleAbort()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <DialogTitle className="text-base">
              Merge Conflict Resolution
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <code className="rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
              {conflictData.currentBranch}
            </code>
            <ArrowRight className="h-3 w-3" />
            <code className="rounded bg-accent px-1.5 py-0.5 text-xs font-mono">
              {conflictData.targetBranch}
            </code>
            <span className="mx-2">|</span>
            <span>
              {resolvedCount} / {totalFiles} files resolved
            </span>
          </div>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* File list */}
        <div className="flex gap-3 border-b border-border pb-3">
          <ScrollArea className="flex-1 max-h-24">
            <div className="flex flex-wrap gap-2">
              {conflictData.conflictFiles.map((file, index) => {
                const resolution = resolutions.get(file.path)
                const isActive = index === currentFileIndex
                const isResolved = resolution?.resolved

                return (
                  <button
                    key={file.path}
                    onClick={() => setCurrentFileIndex(index)}
                    className={`cursor-pointer flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-mono transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isResolved
                        ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                        : "bg-accent text-muted-foreground hover:bg-accent/80"
                    }`}
                  >
                    {isResolved ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <FileWarning className="h-3 w-3" />
                    )}
                    {file.path.split("/").pop()}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Current file path */}
        <div className="text-xs text-muted-foreground font-mono">
          {currentFile.path}
          {currentResolution?.resolved && (
            <Badge variant="outline" className="ml-2 text-green-400 border-green-400/30">
              Resolved
            </Badge>
          )}
        </div>

        {/* Content comparison */}
        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="side-by-side" className="h-full flex flex-col">
            <TabsList className="w-fit">
              <TabsTrigger value="side-by-side" className="text-xs">Side by Side</TabsTrigger>
              <TabsTrigger value="conflict" className="text-xs">With Markers</TabsTrigger>
              {customEditing && (
                <TabsTrigger value="custom" className="text-xs">Custom Edit</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="side-by-side" className="flex-1 overflow-hidden mt-2">
              <div className="grid grid-cols-2 gap-2 h-full">
                {/* Ours (target branch - HEAD during merge) */}
                <div className="flex flex-col border border-border rounded-md overflow-hidden">
                  <div className="bg-accent/50 px-3 py-1.5 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium">
                      Ours ({conflictData.targetBranch})
                    </span>
                    <button
                      onClick={() => handleChoiceChange("ours")}
                      className={`cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
                        currentResolution?.choice === "ours"
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent hover:bg-accent/80 text-muted-foreground"
                      }`}
                    >
                      {currentResolution?.choice === "ours" ? "Selected" : "Use This"}
                    </button>
                  </div>
                  <ScrollArea className="flex-1">
                    <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-green-400/80">
                      {currentFile.oursContent || "(empty)"}
                    </pre>
                  </ScrollArea>
                </div>

                {/* Theirs (current branch being merged) */}
                <div className="flex flex-col border border-border rounded-md overflow-hidden">
                  <div className="bg-accent/50 px-3 py-1.5 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium">
                      Theirs ({conflictData.currentBranch})
                    </span>
                    <button
                      onClick={() => handleChoiceChange("theirs")}
                      className={`cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
                        currentResolution?.choice === "theirs"
                          ? "bg-primary text-primary-foreground"
                          : "bg-accent hover:bg-accent/80 text-muted-foreground"
                      }`}
                    >
                      {currentResolution?.choice === "theirs" ? "Selected" : "Use This"}
                    </button>
                  </div>
                  <ScrollArea className="flex-1">
                    <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-blue-400/80">
                      {currentFile.theirsContent || "(empty)"}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="conflict" className="flex-1 overflow-hidden mt-2">
              <div className="h-full border border-border rounded-md overflow-hidden flex flex-col">
                <div className="bg-accent/50 px-3 py-1.5 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-medium">File with Conflict Markers</span>
                  <button
                    onClick={() => handleChoiceChange("custom")}
                    className={`cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
                      currentResolution?.choice === "custom"
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent hover:bg-accent/80 text-muted-foreground"
                    }`}
                  >
                    Edit Manually
                  </button>
                </div>
                <ScrollArea className="flex-1">
                  <pre className="p-3 text-xs font-mono whitespace-pre leading-relaxed">
                    {currentFile.conflictMarkers.split("\n").map((line, i) => {
                      let className = "text-muted-foreground"
                      if (line.startsWith("<<<<<<<")) className = "text-amber-400 font-bold"
                      else if (line.startsWith("=======")) className = "text-amber-400 font-bold"
                      else if (line.startsWith(">>>>>>>")) className = "text-amber-400 font-bold"
                      else if (line.startsWith("|||||||")) className = "text-amber-400 font-bold"
                      return (
                        <div key={i} className={className}>
                          {line || " "}
                        </div>
                      )
                    })}
                  </pre>
                </ScrollArea>
              </div>
            </TabsContent>

            {customEditing && (
              <TabsContent value="custom" className="flex-1 overflow-hidden mt-2">
                <div className="h-full border border-border rounded-md overflow-hidden flex flex-col">
                  <div className="bg-accent/50 px-3 py-1.5 border-b border-border">
                    <span className="text-xs font-medium">Custom Resolution</span>
                  </div>
                  <textarea
                    value={customContent}
                    onChange={(e) => setCustomContent(e.target.value)}
                    className="flex-1 p-3 text-xs font-mono bg-background resize-none focus:outline-none"
                    placeholder="Enter your resolved content here..."
                  />
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>

        <DialogFooter className="flex items-center justify-between gap-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <button
              onClick={handleAbort}
              disabled={loading}
              className="cursor-pointer flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Abort Merge
            </button>
          </div>

          <div className="flex items-center gap-2">
            {!currentResolution?.resolved && (
              <button
                onClick={handleResolveFile}
                disabled={loading}
                className="cursor-pointer flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/80 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Resolve This File
              </button>
            )}

            {allResolved && (
              <button
                onClick={handleCompleteMerge}
                disabled={loading}
                className="cursor-pointer flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                <Check className="h-3 w-3" />
                Complete Merge
              </button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
