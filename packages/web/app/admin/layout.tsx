"use client"

import { useEffect } from "react"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Override the body's overflow-hidden from root layout
  useEffect(() => {
    document.body.style.overflow = "auto"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  return (
    <div className="min-h-screen overflow-auto">
      {children}
    </div>
  )
}
