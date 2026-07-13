"use client"

import { formatDistanceToNow } from "date-fns"
import {
  LogIn,
  LogOut,
  MessageSquare,
  FolderPlus,
  Trash2,
  Settings,
  ShieldCheck,
  ShieldOff,
  LucideIcon,
  Filter,
  X,
  Bot,
  Cpu,
  Calendar,
  AlertTriangle,
} from "lucide-react"

interface Activity {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface ActivityFilters {
  actions: string[]
  agents: string[]
  models: string[]
}

interface ActivityFilterState {
  action?: string
  agent?: string
  model?: string
  dateFrom?: string
  dateTo?: string
}

interface ActivityFeedProps {
  activities: Activity[]
  filters?: ActivityFilters
  filterState: ActivityFilterState
  onFilterChange: (filters: ActivityFilterState) => void
  isLoading?: boolean
  onLoadMore?: () => void
  hasMore?: boolean
}

const ACTION_CONFIG: Record<
  string,
  { icon: LucideIcon; label: string; color: string }
> = {
  login: { icon: LogIn, label: "logged in", color: "text-green-600" },
  logout: { icon: LogOut, label: "logged out", color: "text-gray-600" },
  chat_created: { icon: FolderPlus, label: "created a chat", color: "text-blue-600" },
  chat_deleted: { icon: Trash2, label: "deleted a chat", color: "text-red-600" },
  message_sent: { icon: MessageSquare, label: "sent a message", color: "text-purple-600" },
  settings_updated: { icon: Settings, label: "updated settings", color: "text-orange-600" },
  admin_promoted: { icon: ShieldCheck, label: "promoted user to admin", color: "text-green-600" },
  admin_demoted: { icon: ShieldOff, label: "removed admin status", color: "text-red-600" },
  llm_provider_error: { icon: AlertTriangle, label: "hit an LLM provider error", color: "text-red-600" },
}

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  chat_created: "Chat Created",
  chat_deleted: "Chat Deleted",
  message_sent: "Message Sent",
  settings_updated: "Settings Updated",
  admin_promoted: "Admin Promoted",
  admin_demoted: "Admin Demoted",
  sandbox_created: "Sandbox Created",
  sandbox_deleted: "Sandbox Deleted",
  daily_limit_reached: "Daily Limit Reached",
  llm_provider_error: "LLM Provider Error",
}

function ActivityItem({ activity }: { activity: Activity }) {
  const config = ACTION_CONFIG[activity.action] || {
    icon: MessageSquare,
    label: activity.action,
    color: "text-muted-foreground",
  }
  const Icon = config.icon

  const metadata = activity.metadata as Record<string, string> | null
  const agent = metadata?.agent
  const model = metadata?.model
  const details = metadata?.repo || metadata?.targetUserName || metadata?.chatId
  // llm_provider_error carries the failure category + the raw error text.
  const errorCategory = metadata?.category
  const errorMessage = metadata?.message

  return (
    <div className="flex items-start gap-3 py-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted ${config.color}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">
            {activity.userName || activity.userEmail || "Unknown user"}
          </span>{" "}
          <span className="text-muted-foreground">{config.label}</span>
          {details && (
            <span className="text-muted-foreground"> - {details}</span>
          )}
        </p>
        {(agent || model || errorCategory) && (
          <div className="mt-1 flex flex-wrap gap-2">
            {agent && (
              <span className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                <Bot className="h-3 w-3" />
                {agent}
              </span>
            )}
            {model && (
              <span className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                <Cpu className="h-3 w-3" />
                {model}
              </span>
            )}
            {errorCategory && (
              <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3 w-3" />
                {errorCategory}
              </span>
            )}
          </div>
        )}
        {errorMessage && (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {errorMessage}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
        </p>
      </div>
      {activity.userImage && (
        <img
          src={activity.userImage}
          alt=""
          className="h-8 w-8 rounded-full"
        />
      )}
    </div>
  )
}

function ActivityFiltersBar({
  filters,
  filterState,
  onFilterChange,
}: {
  filters: ActivityFilters
  filterState: ActivityFilterState
  onFilterChange: (filters: ActivityFilterState) => void
}) {
  const hasActiveFilters = filterState.action || filterState.agent || filterState.model || filterState.dateFrom || filterState.dateTo

  const clearAll = () => {
    onFilterChange({})
  }

  return (
    <div className="space-y-3 border-b pb-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>

      <div className="grid gap-2 grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {/* Action filter */}
        <select
          value={filterState.action || ""}
          onChange={(e) => onFilterChange({ ...filterState, action: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 sm:px-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Actions</option>
          {filters.actions.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action] || action}
            </option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={filterState.agent || ""}
          onChange={(e) => onFilterChange({ ...filterState, agent: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 sm:px-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={filters.agents.length === 0}
        >
          <option value="">All Agents</option>
          {filters.agents.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>

        {/* Model filter */}
        <select
          value={filterState.model || ""}
          onChange={(e) => onFilterChange({ ...filterState, model: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 sm:px-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={filters.models.length === 0}
        >
          <option value="">All Models</option>
          {filters.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>

        {/* Date range filter */}
        <div className="flex gap-1 sm:gap-2">
          <input
            type="date"
            value={filterState.dateFrom || ""}
            onChange={(e) => onFilterChange({ ...filterState, dateFrom: e.target.value || undefined })}
            className="h-9 w-full rounded-md border border-input bg-background px-1 sm:px-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="From"
          />
          <input
            type="date"
            value={filterState.dateTo || ""}
            onChange={(e) => onFilterChange({ ...filterState, dateTo: e.target.value || undefined })}
            className="h-9 w-full rounded-md border border-input bg-background px-1 sm:px-3 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="To"
          />
        </div>
      </div>

      {/* Active filters display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {filterState.action && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 sm:px-3 sm:py-1 text-xs font-medium text-primary">
              <span className="hidden sm:inline">Action: </span>{ACTION_LABELS[filterState.action] || filterState.action}
              <button
                onClick={() => onFilterChange({ ...filterState, action: undefined })}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filterState.agent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 sm:px-3 sm:py-1 text-xs font-medium text-primary">
              <Bot className="h-3 w-3" />
              <span className="hidden sm:inline">Agent: </span>{filterState.agent}
              <button
                onClick={() => onFilterChange({ ...filterState, agent: undefined })}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filterState.model && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 sm:px-3 sm:py-1 text-xs font-medium text-primary">
              <Cpu className="h-3 w-3" />
              <span className="hidden sm:inline">Model: </span>{filterState.model}
              <button
                onClick={() => onFilterChange({ ...filterState, model: undefined })}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {(filterState.dateFrom || filterState.dateTo) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 sm:px-3 sm:py-1 text-xs font-medium text-primary">
              <Calendar className="h-3 w-3" />
              {filterState.dateFrom && filterState.dateTo
                ? `${filterState.dateFrom} → ${filterState.dateTo}`
                : filterState.dateFrom
                  ? `From ${filterState.dateFrom}`
                  : `To ${filterState.dateTo}`}
              <button
                onClick={() => onFilterChange({ ...filterState, dateFrom: undefined, dateTo: undefined })}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function ActivityFeed({
  activities,
  filters,
  filterState,
  onFilterChange,
  isLoading,
  onLoadMore,
  hasMore,
}: ActivityFeedProps) {
  if (isLoading && activities.length === 0) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (activities.length === 0) {
    return (
      <div>
        {filters && (
          <ActivityFiltersBar
            filters={filters}
            filterState={filterState}
            onFilterChange={onFilterChange}
          />
        )}
        <div className="py-8 text-center text-muted-foreground">
          {hasActiveFilters(filterState) ? "No activity matches your filters" : "No activity recorded yet"}
        </div>
      </div>
    )
  }

  return (
    <div>
      {filters && (
        <ActivityFiltersBar
          filters={filters}
          filterState={filterState}
          onFilterChange={onFilterChange}
        />
      )}
      <div className="divide-y">
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoading}
          className="mt-4 w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          {isLoading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  )
}

function hasActiveFilters(filterState: ActivityFilterState): boolean {
  return !!(filterState.action || filterState.agent || filterState.model || filterState.dateFrom || filterState.dateTo)
}
