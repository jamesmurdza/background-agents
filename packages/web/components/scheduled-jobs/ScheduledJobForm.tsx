"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { Clock, ChevronDown, X, Copy, RefreshCw, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentLabels, getModelLabel } from "@/lib/types"
import { AgentIcon } from "@/components/icons/agent-icons"
import { ScheduleFields } from "@/components/scheduled-jobs/ScheduleFields"
import { TRIGGER_TYPES, AVAILABLE_AGENTS } from "@/components/scheduled-jobs/form-config"
import { useScheduledJobForm } from "@/lib/hooks/useScheduledJobForm"

// =============================================================================
// Types
// =============================================================================

interface ScheduledJobFormProps {
  open: boolean
  job?: ScheduledJob | null
  onClose: () => void
  onSuccess: (job: ScheduledJob) => void
  isMobile?: boolean
}

// =============================================================================
// Component
// =============================================================================

export function ScheduledJobForm({ open, job, onClose, onSuccess, isMobile = false }: ScheduledJobFormProps) {
  const {
    isEditing,
    jobId,
    name,
    prompt,
    repo,
    baseBranch,
    isRepoLess,
    agent,
    model,
    triggerType,
    intervalMinutes,
    isCustomInterval,
    customIntervalValue,
    customIntervalUnit,
    runAtHourLocal,
    runAtDay,
    autoPR,
    continueFromLastRun,
    loading,
    error,
    materializedJobId,
    showAgentDropdown,
    showModelDropdown,
    incomingToken,
    copiedUrl,
    rotating,
    availableModels,
    timezoneName,
    effectiveIntervalMinutes,
    showContinueOption,
    showAutoPROption,
    hasOptions,
    incomingWebhookUrl,
    setName,
    setPrompt,
    setRepo,
    setBaseBranch,
    setTriggerType,
    setIntervalMinutes,
    setIsCustomInterval,
    setCustomIntervalValue,
    setCustomIntervalUnit,
    setRunAtHourLocal,
    setRunAtDay,
    setAutoPR,
    setContinueFromLastRun,
    setShowAgentDropdown,
    setShowModelDropdown,
    materializeJob,
    handleSubmit,
    handleClose,
    handleCopyUrl,
    handleRotateToken,
    handleAgentChange,
    handleModelChange,
  } = useScheduledJobForm({ open, job, onClose, onSuccess })

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full border border-border rounded-lg shadow-xl max-h-[90vh]",
            !isMobile && "max-w-2xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <Clock className="h-4 w-4" />
                {isEditing ? "Edit Scheduled Agent" : "New Scheduled Agent"}
              </>
            }
          />

          {/* Form */}
          <form id="scheduled-job-form" onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Dependency Updates"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Trigger Type - Segmented Control. Always editable — PATCH
                handles the swap for both still-open drafts and existing
                jobs. */}
            <div>
              <label className="block text-sm font-medium mb-2">Trigger</label>
              <div className="inline-flex rounded-md bg-muted p-0.5">
                {TRIGGER_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTriggerType(t.value)}
                    className={cn(
                      "px-3 py-1 text-sm rounded-md transition-colors cursor-pointer",
                      triggerType === t.value
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule - only for scheduled trigger */}
            {triggerType === "interval" && (
              <ScheduleFields
                isCustomInterval={isCustomInterval}
                intervalMinutes={intervalMinutes}
                customIntervalValue={customIntervalValue}
                customIntervalUnit={customIntervalUnit}
                runAtDay={runAtDay}
                runAtHourLocal={runAtHourLocal}
                effectiveIntervalMinutes={effectiveIntervalMinutes}
                timezoneName={timezoneName}
                setIsCustomInterval={setIsCustomInterval}
                setIntervalMinutes={setIntervalMinutes}
                setCustomIntervalValue={setCustomIntervalValue}
                setCustomIntervalUnit={setCustomIntervalUnit}
                setRunAtDay={setRunAtDay}
                setRunAtHourLocal={setRunAtHourLocal}
              />
            )}

            {/* Incoming webhook URL panel — shown only for incoming triggers.
                The token is minted client-side as soon as the trigger is
                picked, so the URL (with copy + rotate) renders immediately,
                even before the job is saved. The fallback below only shows for
                the brief moment before the mint effect runs. */}
            {triggerType === "incoming" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">Webhook URL</label>

                {incomingToken ? (
                  <>
                    <div className="flex items-stretch gap-1">
                      <input
                        type="text"
                        readOnly
                        value={incomingWebhookUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer"
                        title={copiedUrl ? "Copied" : "Copy URL"}
                      >
                        {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={handleRotateToken}
                        disabled={rotating}
                        className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
                        title="Generate a new URL and invalidate the existing one"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", rotating && "animate-spin")} />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Anyone with this URL can fire this agent — rotate it if it leaks.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Preparing your webhook URL…
                  </p>
                )}
              </div>
            )}

            {/* Prompt Field - styled like ChatInput */}
            <div>
              <label className="block text-sm font-medium mb-1">Prompt</label>
              <div className={cn(
                "relative flex flex-col border shadow-sm bg-card border-border",
                isMobile ? "rounded-xl" : "rounded-2xl",
                "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
              )}>
                {/* Textarea */}
                <div className={cn(isMobile ? "px-3 py-2" : "px-4 py-3")}>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="What should the agent do?"
                    rows={4}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none"
                  />
                </div>

                {/* Bottom bar with selectors. The container wrappers mirror
                    ChatInput so the inner pickers can reveal labels and counts
                    at the right widths via container queries. */}
                <div className={cn(
                  "@container flex items-center",
                  isMobile ? "gap-2 px-3 py-2" : "gap-3 px-4 py-2"
                )}>
                  {/* Left side items (repo / branch / MCP) */}
                  <div className={cn(
                    "flex items-center gap-2",
                    isMobile ? "w-full @container/row1" : "flex-1"
                  )}>
                    {/* Repo selector */}
                    <RepoCombobox
                      value={repo || null}
                      onChange={(newRepo, defaultBranch) => {
                        setRepo(newRepo)
                        setBaseBranch(defaultBranch)
                      }}
                      disabled={isEditing}
                      isMobile={isMobile}
                      showLabel
                    />

                    {/* Clear-repo X — only in create mode; edits keep the
                        repo immutable since the sandbox/branch pipeline is
                        already wired to it. */}
                    {repo && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setRepo("")
                          setBaseBranch("main")
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-0.5"
                        title="Remove repository"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}

                    {/* Branch selector — only meaningful when a repo is set. */}
                    {repo && (
                      <BranchCombobox
                        repo={repo}
                        value={baseBranch}
                        onChange={setBaseBranch}
                        defaultBranch={baseBranch}
                        isMobile={isMobile}
                        showLabel
                      />
                    )}

                    {/* MCP servers picker — inline alongside repo/branch like
                        the chat input. In create mode the first click
                        materializes the job so the picker has a real id;
                        cancel cleans up. */}
                    <McpServersCombobox
                      entityId={materializedJobId ?? jobId ?? "draft"}
                      apiBase="/api/scheduled-jobs"
                      isDraft={!isEditing && !materializedJobId}
                      onMaterializeDraft={materializeJob}
                      isMobile={isMobile}
                    />
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Agent selector */}
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowAgentDropdown(!showAgentDropdown)
                        setShowModelDropdown(false)
                      }}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title={agentLabels[agent]}
                    >
                      <AgentIcon agent={agent} className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{agentLabels[agent]}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showAgentDropdown && (
                      <div className="absolute bottom-full right-0 mb-1 bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40">
                        {AVAILABLE_AGENTS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => handleAgentChange(a)}
                            className={cn(
                              "w-full text-left hover:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                              a === agent && "bg-accent"
                            )}
                          >
                            <AgentIcon agent={a} className="h-3.5 w-3.5" />
                            {agentLabels[a]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Model selector */}
                  <div className="relative" data-dropdown>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowModelDropdown(!showModelDropdown)
                        setShowAgentDropdown(false)
                      }}
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title={getModelLabel(agent, model)}
                    >
                      <span className="hidden sm:inline">{getModelLabel(agent, model)}</span>
                      <span className="sm:hidden">Model</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showModelDropdown && (
                      <div className="absolute bottom-full right-0 mb-1 max-h-64 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52">
                        {availableModels.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => handleModelChange(m.value)}
                            className={cn(
                              "w-full text-left hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer",
                              m.value === model && "bg-accent"
                            )}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Options Section — hidden when neither option applies (e.g. an
                incoming, repo-less job has neither the interval-only
                "continue" toggle nor the repo-only auto-PR toggle). */}
            {hasOptions && (
            <div>
              <label className="block text-sm font-medium mb-2">Options</label>
              <div className="space-y-2">
                {/* Continue from last run — same checkbox in both modes, but
                    the backend interprets it differently: with a repo it
                    reuses the prior branch; repo-less it prepends the prior
                    run's final output as prompt context. */}
                {showContinueOption && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="continueFromLastRun"
                      checked={continueFromLastRun}
                      onChange={(e) => setContinueFromLastRun(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="continueFromLastRun" className="text-sm">
                      {isRepoLess
                        ? "Include the previous run's output as context"
                        : "Include commits from the previous run"}
                    </label>
                  </div>
                )}

                {/* Auto-PR has no target in repo-less mode (no remote to push to). */}
                {showAutoPROption && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoPR"
                      checked={autoPR}
                      onChange={(e) => setAutoPR(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    <label htmlFor="autoPR" className="text-sm">
                      Automatically create PR when there are new commits
                    </label>
                  </div>
                )}
              </div>
            </div>
            )}

          </form>

          {/* Actions - fixed at bottom */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-md hover:bg-accent transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="scheduled-job-form"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {loading ? "Saving..." : isEditing ? "Save Changes" : "Create"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
