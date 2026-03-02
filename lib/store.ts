"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { Repo, Settings } from "./types"
import { defaultSettings } from "./types"

const SETTINGS_KEY = "agenthub:settings"
const REPOS_KEY = "agenthub:repos"

function loadFromLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function useStore() {
  const [repos, setReposRaw] = useState<Repo[]>([])
  const [settings, setSettingsRaw] = useState<Settings>(defaultSettings)
  const [loaded, setLoaded] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load from localStorage on mount
  useEffect(() => {
    setReposRaw(loadFromLocalStorage(REPOS_KEY, []))
    setSettingsRaw({ ...defaultSettings, ...loadFromLocalStorage(SETTINGS_KEY, defaultSettings) })
    setLoaded(true)
  }, [])

  // Debounced save for repos (supports high-frequency updates during streaming)
  const setRepos = useCallback((updater: Repo[] | ((prev: Repo[]) => Repo[])) => {
    setReposRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        localStorage.setItem(REPOS_KEY, JSON.stringify(next))
      }, 200)
      return next
    })
  }, [])

  // Immediate save for settings (infrequent updates)
  const setSettings = useCallback((newSettings: Settings) => {
    setSettingsRaw(newSettings)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings))
  }, [])

  // Force immediate save (call when streaming ends or on important state changes)
  const forceSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    setReposRaw(current => {
      localStorage.setItem(REPOS_KEY, JSON.stringify(current))
      return current
    })
  }, [])

  return { repos, settings, loaded, setRepos, setSettings, forceSave }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
