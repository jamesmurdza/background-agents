import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { fileURLToPath } from "node:url"
import type { MessagePayload } from "@/app/api/chats/[chatId]/messages/_lib/types"

const persistence = vi.hoisted(() => ({ rows: [] as Array<{ role: string; content: string; metadata: { thinking?: string } }> }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {
  $transaction: async (run: (tx: unknown) => Promise<void>) => run({
    message: {
      findMany: async () => [],
      upsert: async ({ create }: { create: (typeof persistence.rows)[number] }) => { persistence.rows.push(create) },
    },
    chat: { updateMany: async () => ({ count: 1 }) },
  }),
} }))
import { persistTurn } from "@/app/api/chats/[chatId]/messages/_lib/persist-turn"

// Real message list, recovery dialog, send wrapper and dispatch. Only auth,
// transport and surrounding display are fixtures; no provider or user browser.
let browser: Browser
let bundle: string
const root = fileURLToPath(new URL("../../../../", import.meta.url))
beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {QueryClient} from '@tanstack/react-query';
      import {ChatMessageList} from './packages/web/components/chat/ChatMessageList';
      import {useSendMessage} from './packages/web/lib/hooks/useSendMessage';
      import {useMessageDispatch} from './packages/web/lib/hooks/useMessageDispatch';
      import {useChatSyncStore} from './packages/web/lib/stores/chat-sync-store';
      import {queryKeys} from './packages/web/lib/query';
      const client=new QueryClient();
      const original={id:'chat',repo:'user/repo',baseBranch:'main',branch:null,sandboxId:'sandbox',sessionId:null,
        createdAt:1,updatedAt:2,status:'error',errorMessage:'Temporary launch failure',agent:'codex',model:'gpt-6.1-sol',
        messages:[{id:'user',role:'user',content:'Keep this prompt',timestamp:1,agent:'codex',model:'gpt-6.1-sol',metadata:{thinking:'ultra'}}],
        ...window.initial};
      window.requests=[]; window.saved=[];
      function App(){
        const [chat,setChat]=React.useState(original);
        const [,rerender]=React.useReducer(x=>x+1,0);
        window.refresh=rerender; window.setChat=patch=>setChat(c=>({...c,...patch}));
        client.setQueryData(queryKeys.chats.list(),[chat]);
        const dispatch=useMessageDispatch({currentChatId:chat.id,currentChat:chat,chats:[chat],isHydrated:true,
          session:window.authenticated?{user:{id:'qa'},expires:'2099'}:null,settings:{},credentialFlags:{},
          updateChatsCache:fn=>{const next=fn(client.getQueryData(queryKeys.chats.list())??[]);client.setQueryData(queryKeys.chats.list(),next);setChat(next[0])},
          startStreaming:()=>{},suggestNameMutation:{mutate:()=>{}},isDraftChatId:()=>false,materializeDraft:async()=>null,
          reloadMessages:async()=>{},queryClient:client,onConflictStateChangeRef:{current:null}});
        window.stop=dispatch.stopAgent;
        const send=useSendMessage({sidebar:{repoFilter:'all',setRepoFilter:()=>{}},displayCurrentChat:chat,
          currentChatId:chat.id,isDraftMode:false,sendMessage:dispatch.sendMessage,setOptimisticDraft:()=>{},
          openSignInModal:()=>{window.signInOpened=true}});
        window.wrapperSend=send.handleSendMessage;
        window.snapshot=()=>({chat,drafts:useChatSyncStore.getState().localChatState.drafts,sending:send.isSendingMessage});
        return <ChatMessageList chat={chat} isMobile={false} isRunning={false} isCreating={false} isNewRepo={false}
          git={{canBranch:false}} onSendMessage={send.handleSendMessage} currentAgent="codex" currentModel={window.currentModel??'gpt-6-luna'}
          currentThinking={window.composerThinking??'high'} planModeEnabled={false} messagesContainerRef={{current:null}}
          messagesEndRef={{current:null}} onScroll={()=>{}} userHasScrolledUp={false} onScrollToBottom={()=>{}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: "controlled-surroundings", setup(builder) {
      builder.onResolve({ filter: /^(next-auth\/react|\.\.\/MessageBubble|\.\/useServerQueue)$/ }, args => ({ path: args.path, namespace: "fixture" }))
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
        args.path === "next-auth/react" ? "export const useSession=()=>({data:window.authenticated?{user:{id:'qa'}}:null});"
          : args.path === "../MessageBubble" ? "export const MessageBubble=()=>null;"
            : "export const useServerQueue=()=>({enqueueMessage:()=>{},removeQueuedMessage:()=>{},resumeQueue:()=>{}});" }))
    } }],
    alias: { "@": `${root}/packages/web`, react: `${root}/packages/web/node_modules/react`, "react-dom": `${root}/node_modules/react-dom`, "@background-agents/sdk/thinking": `${root}/packages/sdk/src/thinking.ts` },
    bundle: true, platform: "browser", write: false, define: { "process.env.NODE_ENV": '"development"' },
  })
  bundle = result.outputFiles[0].text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })
afterEach(async () => {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) await page.unrouteAll({ behavior: "ignoreErrors" })
    await context.close()
  }
})

async function mount(initial: Record<string, unknown> = {}) {
  persistence.rows = []
  const page = await browser.newPage()
  await page.route("https://thinking-list.test/**", async route => {
    const url = new URL(route.request().url()).pathname
    if (url.includes("/thinking")) return route.fulfill({ json: { status: "available", levels: ["low", "medium", "high"] } })
    if (url.includes("/messages") && route.request().method() === "POST") {
      const payload: MessagePayload = route.request().postDataJSON()
      const outcome = await page.evaluate(data => {
        const state = window as unknown as { requests: unknown[]; saved: unknown[]; outcome?: string }
        state.requests.push(data)
        return state.outcome
      }, payload)
      if (outcome === "pending") {
        await page.waitForFunction(() => Reflect.get(window, "outcome") !== "pending")
        return route.fulfill({ json: { sandboxId: "sandbox", backgroundSessionId: "job" } })
      }
      if (outcome === "uncertain") return route.abort("failed")
      if (outcome === "server_login") return route.fulfill({ status: 401, json: { error: "Unauthorized" } })
      if (outcome === "pull_conflict") return route.fulfill({ status: 409, json: { error: "PULL_CONFLICT", conflictedFiles: ["a.txt"] } })
      if (outcome === "busy") return route.fulfill({ status: 409, json: { error: "Chat is busy", isChatBusy: true } })
      await persistTurn({ chatId: "chat", payload, agentPrompt: payload.message, uploadedFilePaths: [],
        usageMeta: { pool: "user", provider: "codex" }, backgroundSessionId: "job", isAgentSwitch: false })
      return route.fulfill({ json: { sandboxId: "sandbox", backgroundSessionId: "job" } })
    }
    if (url.includes("/api/agent/stop")) {
      await page.waitForFunction(() => Reflect.get(window, "stopFinished"))
      return route.fulfill({ json: {} })
    }
    if (url.includes("/api/")) return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
  })
  await page.goto("https://thinking-list.test/")
  await page.evaluate(value => Object.assign(window, { initial: value, authenticated: true, outcome: "busy" }), initial)
  await page.addScriptTag({ content: bundle })
  return page
}

async function chooseHigh(page: Page) {
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await page.getByRole("combobox", { name: "Thinking level" }).click()
  await page.getByRole("option", { name: "High", exact: true }).click()
}

describe("message-list actions through actual send wrapper (controlled browser)", () => {
  it.each(["busy", "pull_conflict", "login", "server_login", "stop"])("retains High after %s rejection until explicit retry is accepted", async outcome => {
    const page = await mount({ backgroundSessionId: "old-job", activeAssistantMessageId: "old-assistant" })
    await chooseHigh(page)
    await page.evaluate(value => {
      Object.assign(window, { outcome: value })
      if (value === "login") { Object.assign(window, { authenticated: false }); Reflect.get(window, "refresh")() }
      if (value === "stop") Reflect.get(window, "stop")()
    }, outcome)
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    const dialog = page.getByRole("dialog")
    await vi.waitFor(async () => expect(await dialog.count()).toBe(1))
    await dialog.getByRole("alert").waitFor({ timeout: 1000 })
    expect(await dialog.getByRole("alert").textContent()).toMatch(/working|stopping|conflict|Sign in/)
    expect(await dialog.getByRole("combobox", { name: "Thinking level" }).textContent()).toContain("High")
    expect(await page.evaluate(() => sessionStorage.getItem("simple-chat-pending-message"))).toBeNull()
    await page.evaluate(() => Object.assign(window, { outcome: "accepted", authenticated: true, stopFinished: true }))
    await page.evaluate(() => Reflect.get(window, "setChat")({ status: "error", stopPending: false }))
    // No status/auth transition may replay this recovery automatically.
    const before = await page.evaluate(() => Reflect.get(window, "requests").length)
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    const requests = await page.evaluate(() => Reflect.get(window, "requests"))
    expect(requests).toHaveLength(before + 1)
    expect(requests.at(-1)).toMatchObject({ message: "Keep this prompt", model: "gpt-6-luna", thinking: "high" })
    expect(await page.evaluate(() => Reflect.get(window, "snapshot")().drafts.chat)).toBeUndefined()
    await page.close()
  })

  it("keeps an in-flight dialog and prevents duplicate confirmation", async () => {
    const page = await mount()
    await chooseHigh(page)
    await page.evaluate(() => Object.assign(window, { outcome: "pending" }))
    await page.getByRole("button", { name: "Confirm and retry" }).dblclick()
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(1))
    expect(await page.getByRole("button", { name: "Confirm and retry" }).isDisabled()).toBe(true)
    expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1)
    await page.evaluate(() => Object.assign(window, { outcome: "accepted" }))
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    await page.close()
  })

  it("hands an uncertain dispatch to read-only recovery without resending", async () => {
    const page = await mount()
    await chooseHigh(page)
    await page.evaluate(() => Object.assign(window, { outcome: "uncertain" }))
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "snapshot")().chat.status)).toBe("disconnected"))
    expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1)
    expect(await page.getByRole("button", { name: "Retry", exact: true }).count()).toBe(0)
    await page.close()
  })

  it.each(["busy", "pending"])("does not resurrect a %s retry after changing model away and back", async outcome => {
    const page = await mount()
    await chooseHigh(page)
    await page.evaluate(value => Object.assign(window, { outcome: value }), outcome)
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    if (outcome === "busy") await page.getByRole("dialog").getByRole("alert").waitFor()
    await page.evaluate(() => { Object.assign(window, { currentModel: "gpt-6.1-sol" }); Reflect.get(window, "refresh")() })
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    const settled = outcome === "pending" ? page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/messages")) : Promise.resolve()
    await page.evaluate(() => { Object.assign(window, { currentModel: "gpt-6-luna", outcome: "accepted" }); Reflect.get(window, "refresh")() })
    await settled
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "snapshot")().sending)).toBe(false))
    expect(await page.getByRole("dialog").count()).toBe(0)
    expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1)
    await page.close()
  })

  it("warns that historical attachments cannot be recreated rather than claiming to retain File objects", async () => {
    const page = await mount({ messages: [{ id: "user", role: "user", content: "Keep this prompt", timestamp: 1,
      agent: "codex", model: "gpt-6.1-sol", metadata: { thinking: "ultra" }, uploadedFiles: ["old-notes.txt"] }] })
    await chooseHigh(page)
    expect(await page.getByRole("dialog").getByRole("alert").textContent()).toContain("Previously uploaded files cannot be reattached by Retry: old-notes.txt")
    expect(await page.getByRole("dialog").textContent()).not.toContain("Attachments retained")
    await page.close()
  })

  it("keeps a second chat's retry usable while the previous chat dispatch is in flight", async () => {
    const page = await mount()
    await chooseHigh(page)
    await page.evaluate(() => Object.assign(window, { outcome: "pending" }))
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1))
    await page.evaluate(() => Reflect.get(window, "setChat")({ id: "chat-b", status: "error", errorMessage: "Temporary launch failure",
      messages: [{ id: "user-b", role: "user", content: "Keep prompt B", timestamp: 1, agent: "codex", model: "gpt-6.1-sol", metadata: { thinking: "ultra" } }] }))
    await chooseHigh(page)
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    await page.getByRole("dialog").getByRole("alert").waitFor({ timeout: 1000 })
    expect(await page.getByRole("dialog").getByRole("alert").textContent()).toContain("previous retry")
    expect(await page.getByRole("button", { name: "Confirm and retry" }).isDisabled()).toBe(false)
    expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1)
    // Cancelling B must not be blocked by the still-pending request A.
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    await chooseHigh(page)
    const previousSettled = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/messages"))
    await page.evaluate(() => Object.assign(window, { outcome: "accepted" }))
    await previousSettled
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "snapshot")().sending)).toBe(false))
    await page.getByRole("button", { name: "Confirm and retry" }).click()
    await vi.waitFor(async () => expect(await page.getByRole("dialog").count()).toBe(0))
    const requests = await page.evaluate(() => Reflect.get(window, "requests"))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ message: "Keep prompt B", thinking: "high" })
    await page.close()
  })

  it.each(["high", "default"])("sends Commit changes with composer %s in payload and metadata", async thinking => {
    const page = await mount({ status: "ready", uncommittedFilesCount: 2 })
    await page.evaluate(value => { Object.assign(window, { composerThinking: value, outcome: "accepted" }); Reflect.get(window, "refresh")() }, thinking)
    await page.getByTestId("uncommitted-files-commit").click()
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1))
    const request = await page.evaluate(() => Reflect.get(window, "requests")[0])
    expect(request).toMatchObject({ message: "Commit changes", thinking })
    const snapshot = await page.evaluate(() => Reflect.get(window, "snapshot")())
    expect(snapshot.chat.messages.find((message: { content: string }) => message.content === "Commit changes").metadata.thinking).toBe(thinking)
    expect(snapshot.chat.messages.find((message: { id: string }) => message.id === "user").metadata.thinking).toBe("ultra")
    expect(persistence.rows).toHaveLength(2)
    expect(persistence.rows.find(row => row.role === "user")).toMatchObject({ content: "Commit changes", metadata: { thinking } })
    expect(persistence.rows.find(row => row.role === "assistant")?.metadata.thinking).toBe(thinking)
    await page.close()
  })
})
