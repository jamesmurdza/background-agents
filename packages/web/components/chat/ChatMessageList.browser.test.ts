import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { fileURLToPath } from "node:url"
import type { MessagePayload } from "@/app/api/chats/[chatId]/messages/_lib/types"

const persistence = vi.hoisted(() => ({ rows: [] as Array<{ role: string; content: string; metadata: { reasoningEffort?: string } }> }))
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

// Real message list, send wrapper and dispatch. Only auth,
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
        messages:[{id:'user',role:'user',content:'Keep this prompt',timestamp:1,agent:'codex',model:'gpt-6.1-sol',metadata:{reasoningEffort:'ultra'}}],
        ...window.initial};
      window.requests=[];
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
        const send=useSendMessage({sidebar:{repoFilter:'all',setRepoFilter:()=>{}},displayCurrentChat:chat,
          currentChatId:chat.id,isDraftMode:false,sendMessage:dispatch.sendMessage,setOptimisticDraft:()=>{},
          openSignInModal:()=>{window.signInOpened=true}});
        window.wrapperSend=send.handleSendMessage;
        window.snapshot=()=>({chat,drafts:useChatSyncStore.getState().localChatState.drafts,sending:send.isSendingMessage});
        return <ChatMessageList chat={chat} isMobile={false} isRunning={false} isCreating={false} isNewRepo={false}
          git={{canBranch:false}} onSendMessage={send.handleSendMessage} currentAgent="codex" currentModel={window.currentModel??'gpt-6-luna'}
          currentReasoningEffort={window.composerReasoningEffort??'high'} planModeEnabled={false} messagesContainerRef={{current:null}}
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
    alias: { "@": `${root}/packages/web`, react: `${root}/packages/web/node_modules/react`, "react-dom": `${root}/node_modules/react-dom`, "@background-agents/sdk/reasoning-effort": `${root}/packages/sdk/src/reasoning-effort.ts` },
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
  await page.route("https://reasoning-effort-list.test/**", async route => {
    const url = new URL(route.request().url()).pathname
    if (url.includes("/reasoning-effort")) return route.fulfill({ json: { status: "available", levels: ["low", "medium", "high"] } })
    if (url.includes("/messages") && route.request().method() === "POST") {
      const payload: MessagePayload = route.request().postDataJSON()
      await page.evaluate(data => { (window as unknown as { requests: unknown[] }).requests.push(data) }, payload)
      await persistTurn({ chatId: "chat", payload, displayContent: payload.message, uploadedFilePaths: [],
        usageMeta: { pool: "user", provider: "codex" }, backgroundSessionId: "job", isAgentSwitch: false })
      return route.fulfill({ json: { sandboxId: "sandbox", backgroundSessionId: "job" } })
    }
    if (url.includes("/api/")) return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
  })
  await page.goto("https://reasoning-effort-list.test/")
  await page.evaluate(value => Object.assign(window, { initial: value, authenticated: true }), initial)
  await page.addScriptTag({ content: bundle })
  return page
}

describe("message-list actions through actual send wrapper (controlled browser)", () => {
  // Retry is a new send of the last prompt with what the composer shows now,
  // the same rule the base app already uses for agent/model.
  it.each([
    { name: "a different model", currentModel: "gpt-6-luna", composerReasoningEffort: "high" },
    { name: "the same model", currentModel: "gpt-6.1-sol", composerReasoningEffort: "default" },
  ])("retries with the composer reasoning effort on $name", async ({ currentModel, composerReasoningEffort }) => {
    const page = await mount()
    await page.evaluate(value => { Object.assign(window, value); Reflect.get(window, "refresh")() }, { currentModel, composerReasoningEffort })
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1))
    expect(await page.evaluate(() => Reflect.get(window, "requests")[0]))
      .toMatchObject({ message: "Keep this prompt", agent: "codex", model: currentModel, reasoningEffort: composerReasoningEffort })
    expect(await page.getByRole("dialog").count()).toBe(0)
    await page.close()
  })

  it.each(["high", "default"])("sends Commit changes with composer %s in payload and metadata", async reasoningEffort => {
    const page = await mount({ status: "ready", uncommittedFilesCount: 2 })
    await page.evaluate(value => { Object.assign(window, { composerReasoningEffort: value }); Reflect.get(window, "refresh")() }, reasoningEffort)
    await page.getByTestId("uncommitted-files-commit").click()
    await vi.waitFor(async () => expect(await page.evaluate(() => Reflect.get(window, "requests").length)).toBe(1))
    const request = await page.evaluate(() => Reflect.get(window, "requests")[0])
    expect(request).toMatchObject({ message: "Commit changes", reasoningEffort })
    const snapshot = await page.evaluate(() => Reflect.get(window, "snapshot")())
    expect(snapshot.chat.messages.find((message: { content: string }) => message.content === "Commit changes").metadata.reasoningEffort).toBe(reasoningEffort)
    expect(snapshot.chat.messages.find((message: { id: string }) => message.id === "user").metadata.reasoningEffort).toBe("ultra")
    expect(persistence.rows).toHaveLength(2)
    expect(persistence.rows.find(row => row.role === "user")).toMatchObject({ content: "Commit changes", metadata: { reasoningEffort } })
    expect(persistence.rows.find(row => row.role === "assistant")?.metadata.reasoningEffort).toBe(reasoningEffort)
    await page.close()
  })
})
