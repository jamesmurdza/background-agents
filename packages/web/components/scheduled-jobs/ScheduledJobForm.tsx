"use client"

import { useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { AlarmClock, ChevronDown } from "lucide-react"
import { cn, MODAL_OVERLAY_CLASS } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { RepoCombobox } from "@/components/chat/RepoCombobox"
import { BranchCombobox } from "@/components/chat/BranchCombobox"
import { McpServersCombobox } from "@/components/chat/McpServersCombobox"
import { type ScheduledJob } from "@/lib/scheduled-jobs/types"
import { agentLabels, getModelLabel } from "@/lib/types"
import { AgentIcon } from "@/components/icons/agent-icons"
import { TriggerOptionsFields } from "@/components/scheduled-jobs/TriggerOptionsFields"
import { AVAILABLE_AGENTS } from "@/components/scheduled-jobs/form-config"
import { useScheduledJobForm } from "@/lib/hooks/useScheduledJobForm"
import { useUpwardMenuMaxHeight } from "@/lib/hooks/useUpwardMenuMaxHeight"

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
    fieldErrors,
    showAgentDropdown,
    showModelDropdown,
    incomingToken,
    copiedUrl,
    rotating,
    availableModels,
    customEndpoints,
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
    handleSubmit,
    handleClose,
    handleCopyUrl,
    handleRotateToken,
    handleAgentChange,
    handleModelChange,
    clearFieldError,
  } = useScheduledJobForm({ open, job, onClose, onSuccess })

  const fieldErrorMessages = Object.values(fieldErrors)

  // Clamp the hand-rolled dropdowns to the space actually available above
  // them, same as the main composer's agent/mode dropdowns, so they scroll
  // instead of overflowing on a short viewport.
  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const agentDropdownMaxHeight = useUpwardMenuMaxHeight(showAgentDropdown, agentDropdownRef)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownMaxHeight = useUpwardMenuMaxHeight(showModelDropdown, modelDropdownRef)

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          MODAL_OVERLAY_CLASS,
          "transition-opacity duration-300",
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
                <AlarmClock className="h-4 w-4" />
                Edit Scheduled Agent
              </>
            }
          />

          {/* Form */}
          <form id="scheduled-job-form" onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
            {error && (
              <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {fieldErrorMessages.length > 0 && (
              <div role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Please fix the following fields:</p>
                <ul className="mt-1 list-disc pl-5">
                  {fieldErrorMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Name */}
            <div>
              <label htmlFor="scheduled-job-name" className="block text-sm font-medium mb-1">Name</label>
              <input
                id="scheduled-job-name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => {
                  const value = e.target.value
                  setName(value)
                  if (value.trim()) clearFieldError("name")
                }}
                placeholder="e.g., Dependency Updates"
                aria-required="true"
                aria-invalid={!!fieldErrors.name}
                aria-describedby={fieldErrors.name ? "scheduled-job-name-error" : undefined}
                className={cn(
                  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                  fieldErrors.name ? "border-destructive" : "border-border"
                )}
              />
              {fieldErrors.name && (
                <p id="scheduled-job-name-error" className="mt-1 text-xs text-destructive">
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <TriggerOptionsFields
              triggerType={triggerType}
              setTriggerType={setTriggerType}
              clearFieldError={clearFieldError}
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
              fieldErrors={fieldErrors}
              incomingToken={incomingToken}
              incomingWebhookUrl={incomingWebhookUrl}
              copiedUrl={copiedUrl}
              rotating={rotating}
              handleCopyUrl={handleCopyUrl}
              handleRotateToken={handleRotateToken}
              isRepoLess={isRepoLess}
              showContinueOption={showContinueOption}
              showAutoPROption={showAutoPROption}
              hasOptions={hasOptions}
              continueFromLastRun={continueFromLastRun}
              setContinueFromLastRun={setContinueFromLastRun}
              autoPR={autoPR}
              setAutoPR={setAutoPR}
            />

            {/* Prompt Field - styled like ChatInput */}
            <div>
              <label htmlFor="scheduled-job-prompt" className="block text-sm font-medium mb-1">Prompt</label>
              <div className={cn(
                "relative flex flex-col border shadow-sm bg-card",
                fieldErrors.prompt ? "border-destructive" : "border-border",
                isMobile ? "rounded-xl" : "rounded-2xl",
                "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20"
              )}>
                {/* Textarea */}
                <div className={cn(isMobile ? "px-3 py-2" : "px-4 py-3")}>
                  <textarea
                    id="scheduled-job-prompt"
                    name="prompt"
                    value={prompt}
                    onChange={(e) => {
                      const value = e.target.value
                      setPrompt(value)
                      if (value.trim()) clearFieldError("prompt")
                    }}
                    placeholder="What should the agent do?"
                    rows={4}
                    aria-required="true"
                    aria-invalid={!!fieldErrors.prompt}
                    aria-describedby={fieldErrors.prompt ? "scheduled-job-prompt-error" : undefined}
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
                    isMobile ? "w-full" : "flex-1"
                  )}>
                    {/* Repo selector — edits keep the repo immutable since
                        the sandbox/branch pipeline is already wired to it. */}
                    <RepoCombobox
                      value={repo || null}
                      onChange={(newRepo, defaultBranch) => {
                        setRepo(newRepo)
                        setBaseBranch(defaultBranch)
                      }}
                      disabled
                      isMobile={isMobile}
                      showLabel
                    />

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
                        the chat input. */}
                    <McpServersCombobox
                      entityId={jobId ?? "draft"}
                      apiBase="/api/scheduled-jobs"
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
                      <span className="hidden @[32rem]:inline">{agentLabels[agent]}</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showAgentDropdown && (
                      <div
                        ref={agentDropdownRef}
                        style={{ maxHeight: agentDropdownMaxHeight }}
                        className="absolute bottom-full right-0 mb-1 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-40"
                      >
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
                      title={getModelLabel(agent, model, customEndpoints)}
                    >
                      <span className="hidden @[32rem]:inline">{getModelLabel(agent, model, customEndpoints)}</span>
                      <span className="@[32rem]:hidden">Model</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    {showModelDropdown && (
                      <div
                        ref={modelDropdownRef}
                        style={{ maxHeight: modelDropdownMaxHeight }}
                        className="absolute bottom-full right-0 mb-1 overflow-y-auto bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-52"
                      >
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
              {fieldErrors.prompt && (
                <p id="scheduled-job-prompt-error" className="mt-1 text-xs text-destructive">
                  {fieldErrors.prompt}
                </p>
              )}
            </div>

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
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
