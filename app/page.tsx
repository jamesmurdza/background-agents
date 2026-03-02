"use client"

import { useState } from "react"
import { repos } from "@/lib/mock-data"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { SettingsModal } from "@/components/settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"

export default function Home() {
  const [activeRepoId, setActiveRepoId] = useState(repos[0].id)
  const [activeBranchId, setActiveBranchId] = useState<string | null>(repos[0].branches[0].id)
  const [mobileView, setMobileView] = useState<"branches" | "chat">("branches")
  const [branchListWidth, setBranchListWidth] = useState(260)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)

  const activeRepo = repos.find((r) => r.id === activeRepoId)!
  const activeBranch = activeBranchId
    ? activeRepo.branches.find((b) => b.id === activeBranchId) ?? null
    : null

  function handleSelectRepo(repoId: string) {
    setActiveRepoId(repoId)
    const repo = repos.find((r) => r.id === repoId)!
    setActiveBranchId(repo.branches[0]?.id ?? null)
    setMobileView("branches")
  }

  function handleSelectBranch(branchId: string) {
    setActiveBranchId(branchId)
    setMobileView("chat")
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden">
        {/* Repo sidebar - always visible */}
        <RepoSidebar
          repos={repos}
          activeRepoId={activeRepoId}
          onSelectRepo={handleSelectRepo}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddRepo={() => setAddRepoOpen(true)}
        />

        {/* Branch list - hidden only on very small screens */}
        <div className="hidden sm:flex">
          <BranchList
            repo={activeRepo}
            activeBranchId={activeBranchId}
            onSelectBranch={handleSelectBranch}
            width={branchListWidth}
            onWidthChange={setBranchListWidth}
          />
        </div>

        {/* Chat panel - always visible */}
        <div className="flex min-w-0 flex-1">
          {activeBranch ? (
            <ChatPanel
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              onBack={() => setMobileView("branches")}
            />
          ) : (
            <EmptyChatPanel />
          )}
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AddRepoModal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} />
    </>
  )
}
