"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { useChat } from "@/lib/hooks/useChat"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative group">
      <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto text-sm font-mono">
        <code>{children}</code>
      </pre>
      <CopyButton text={children} />
    </div>
  )
}

function Endpoint({
  method,
  path,
  description,
  requestBody,
  response,
  children,
}: {
  method: "GET" | "POST" | "DELETE"
  path: string
  description: string
  requestBody?: string
  response: string
  children?: React.ReactNode
}) {
  const methodColors = {
    GET: "bg-green-500/20 text-green-600 dark:text-green-400",
    POST: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
    DELETE: "bg-red-500/20 text-red-600 dark:text-red-400",
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-4 bg-muted/30">
        <span className={`px-2 py-1 rounded text-xs font-semibold ${methodColors[method]}`}>
          {method}
        </span>
        <code className="text-sm font-mono">{path}</code>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-muted-foreground">{description}</p>

        {requestBody && (
          <div>
            <h4 className="text-sm font-semibold mb-2">Request Body</h4>
            <CodeBlock>{requestBody}</CodeBlock>
          </div>
        )}

        {children}

        <div>
          <h4 className="text-sm font-semibold mb-2">Response</h4>
          <CodeBlock>{response}</CodeBlock>
        </div>
      </div>
    </div>
  )
}

export default function SDKPage() {
  const {
    chats,
    currentChatId,
    settings,
    isHydrated,
    deletingChatIds,
    canCreateChat,
    startNewChat,
    selectChat,
    removeChat,
    updateSettings,
  } = useChat()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)

  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        chats={displayChats}
        currentChatId={displayCurrentChatId}
        deletingChatIds={deletingChatIds}
        canCreateChat={canCreateChat}
        onSelectChat={selectChat}
        onNewChat={startNewChat}
        onDeleteChat={removeChat}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        currentPage="sdk"
      />

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-4xl mx-auto px-6 py-12">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold">REST API Reference</h1>
            <p className="text-muted-foreground mt-2">
              Use this API to programmatically create sandboxes, run agents, and push changes.
            </p>
          </div>

          {/* Endpoints */}
          <section className="space-y-6">
            {/* Create Sandbox */}
            <Endpoint
              method="POST"
              path="/api/sandbox/create"
              description="Create a new sandbox, clone a GitHub repository, and checkout a new branch."
              requestBody={`{
  "repo": "owner/repo",
  "baseBranch": "main",
  "newBranch": "ai/feature",
  "githubToken": "ghp_xxxx"
}`}
              response={`{
  "sandboxId": "sandbox_abc123",
  "repoName": "repo",
  "branch": "ai/feature",
  "previewUrlPattern": "https://{port}-xxx.daytonaproxy.net"
}`}
            />

            {/* Execute Agent */}
            <Endpoint
              method="POST"
              path="/api/agent/execute"
              description="Start an agent to execute a task in the sandbox."
              requestBody={`{
  "sandboxId": "sandbox_abc123",
  "repoName": "repo",
  "prompt": "Add a README.md",
  "agent": "opencode",
  "model": "anthropic/claude-sonnet-4-20250514",
  "anthropicApiKey": "sk-ant-xxxx",
  "openaiApiKey": "sk-xxxx"
}`}
              response={`{
  "backgroundSessionId": "ses_xyz789",
  "status": "running"
}`}
            >
              <div>
                <h4 className="text-sm font-semibold mb-2">Supported Agents</h4>
                <div className="overflow-x-auto text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 font-medium">Agent</th>
                        <th className="text-left py-2 pr-4 font-medium">API Key</th>
                        <th className="text-left py-2 font-medium">Models</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-muted-foreground">
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">opencode</td>
                        <td className="py-2 pr-4">Optional</td>
                        <td className="py-2 font-mono">anthropic/claude-sonnet-4-20250514, openai/gpt-4.1</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">claude-code</td>
                        <td className="py-2 pr-4">anthropicApiKey</td>
                        <td className="py-2 font-mono">claude-sonnet-4-20250514, claude-opus-4-20250514</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">codex</td>
                        <td className="py-2 pr-4">openaiApiKey</td>
                        <td className="py-2 font-mono">o3, gpt-4.1</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">gemini</td>
                        <td className="py-2 pr-4">geminiApiKey</td>
                        <td className="py-2 font-mono">gemini-2.5-pro</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">goose</td>
                        <td className="py-2 pr-4">anthropicApiKey or openaiApiKey</td>
                        <td className="py-2 font-mono">claude-sonnet-4-20250514, gpt-4.1</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono text-foreground">pi</td>
                        <td className="py-2 pr-4">anthropicApiKey, openaiApiKey, or geminiApiKey</td>
                        <td className="py-2 font-mono">sonnet, openai/gpt-4.1</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Endpoint>

            {/* Poll Status */}
            <Endpoint
              method="GET"
              path="/api/agent/status?sandboxId=...&repoName=..."
              description="Poll for agent execution status and output."
              response={`{
  "status": "running" | "completed" | "error",
  "content": "I'll create a README file...",
  "toolCalls": [
    { "tool": "Write", "summary": "README.md", "output": "..." }
  ],
  "contentBlocks": [...],
  "error": null
}`}
            />

            {/* Push */}
            <Endpoint
              method="POST"
              path="/api/git/push"
              description="Push committed changes to the remote GitHub repository."
              requestBody={`{
  "sandboxId": "sandbox_abc123",
  "repoName": "repo",
  "branch": "ai/feature",
  "githubToken": "ghp_xxxx"
}`}
              response={`{ "success": true }`}
            />

            {/* Delete Sandbox */}
            <Endpoint
              method="POST"
              path="/api/sandbox/delete"
              description="Delete a sandbox and clean up resources."
              requestBody={`{ "sandboxId": "sandbox_abc123" }`}
              response={`{ "success": true }`}
            />
          </section>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={updateSettings}
      />
    </div>
  )
}
