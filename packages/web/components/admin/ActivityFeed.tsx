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

interface ActivityFeedProps {
  activities: Activity[]
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
}

function ActivityItem({ activity }: { activity: Activity }) {
  const config = ACTION_CONFIG[activity.action] || {
    icon: MessageSquare,
    label: activity.action,
    color: "text-muted-foreground",
  }
  const Icon = config.icon

  const metadata = activity.metadata as Record<string, string> | null
  const details = metadata?.repo || metadata?.targetUserName || metadata?.chatId

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
        <p className="text-xs text-muted-foreground">
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

export function ActivityFeed({
  activities,
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
      <div className="py-8 text-center text-muted-foreground">
        No activity recorded yet
      </div>
    )
  }

  return (
    <div>
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
