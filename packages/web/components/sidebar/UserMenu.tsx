"use client"

import { useState, useRef } from "react"
import { signOut } from "next-auth/react"
import { Settings, LogOut, HelpCircle, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { clearAllStorage } from "@/lib/storage"
import { useClickOutside } from "@/lib/hooks/useClickOutside"

interface UserMenuProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
    isAdmin?: boolean
  }
  onOpenSettings: () => void
  onOpenHelp?: () => void
  collapsed: boolean
}

export function UserMenu({ user, onOpenSettings, onOpenHelp, collapsed }: UserMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen)

  const avatar = user.image ? (
    <img
      src={user.image}
      alt={user.name || "User"}
      className="h-8 w-8 flex-shrink-0 rounded-full"
    />
  ) : (
    <div className="h-8 w-8 flex-shrink-0 rounded-full bg-muted flex items-center justify-center text-xs">
      {user.name?.[0] || "?"}
    </div>
  )

  return (
    <div className={cn("relative", collapsed ? "flex justify-center" : "")} ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 cursor-pointer rounded-md transition-colors",
          collapsed
            ? "p-0"
            : "w-full min-w-0 px-2 py-1.5 hover:bg-accent text-left"
        )}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {avatar}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user.name}</div>
            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
          </div>
        )}
      </button>

      {menuOpen && (
        <div
          className={cn(
            "absolute bottom-full mb-2 w-44 rounded-md border border-border bg-popover shadow-md py-1 z-50",
            collapsed ? "left-0" : "left-0 right-0 w-auto"
          )}
          role="menu"
        >
          {user.isAdmin && (
            <a
              href="/admin"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
            >
              <BarChart3 className="h-4 w-4" />
              Admin Dashboard
            </a>
          )}
          <button
            onClick={() => {
              onOpenSettings()
              setMenuOpen(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
          {onOpenHelp && (
            <button
              onClick={() => {
                onOpenHelp()
                setMenuOpen(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
              Help
            </button>
          )}
          <button
            onClick={() => {
              clearAllStorage()
              signOut()
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
