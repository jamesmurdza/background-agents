import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright"
import { fileURLToPath } from "node:url"
import { THINKING_BROWSER_TIMEOUT_MS } from "@background-agents/sdk/thinking"

// Real React effects/storage in an isolated headless browser. The catalog and
// transport are controlled fixtures; this is not provider acceptance evidence.
type Snapshot = { thinking: string; ready: boolean; checking?: boolean; notice?: string; capability: { levels: string[]; status?: string; reason?: string } }
interface Harness {
  result: Snapshot
  fetches: number
  setProps: (props: Record<string, unknown>) => void
  setResponse: (response: Record<string, unknown> | "failure") => void
  setThinking: (value: string) => void
  requestThinking?: (value: string) => void
  recheckThinking?: () => void
  onThinkingMenuOpen?: () => void
}
let browser: Browser
let bundle: string
const root = fileURLToPath(new URL("../../../../", import.meta.url))

beforeAll(async () => {
  const built = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {useThinkingPreference} from './packages/web/lib/hooks/useThinkingPreference';
      const h=window.harness={fetches:0};
      let response=window.initialResponse??{levels:['low','high'],status:'available',control:'opencode-variant',runtimeRequired:true};
      h.setResponse=value=>response=value;
      window.fetch=async()=>{h.fetches++; if(response==='failure')throw Error('fixture offline'); return {ok:true,json:async()=>response}};
      function App(){
        const [props,setProps]=React.useState(window.initialProps);
        h.setProps=next=>setProps(previous=>({...previous,...next}));
        const r=useThinkingPreference(props.agent,props.model,props.chatId,props.sandboxId,{readinessKey:props.readinessKey,isStarting:props.isStarting});
        Object.assign(h,{setThinking:r.setThinking,requestThinking:r.requestThinking,recheckThinking:r.recheckThinking,onThinkingMenuOpen:r.onThinkingMenuOpen});
        h.result={thinking:r.thinking,ready:r.ready,checking:r.checking,notice:r.notice,capability:r.capability};
        return React.createElement('pre',null,JSON.stringify(h.result));
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    ` },
    plugins: [{ name: "controlled-catalog", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/thinking$/ }, () => ({ path: "fixture", namespace: "catalog" }))
      builder.onLoad({ filter: /.*/, namespace: "catalog" }, () => ({ contents: `
        import {getThinkingCapability,getVerifiedThinkingCapability} from '@background-agents/sdk/thinking';
        const provider=agent=>agent==='claude-code'?'claude':agent;
        export const thinkingCapability=(agent,model)=>agent!=='opencode'?getThinkingCapability(provider(agent),model):({levels:['low','high'],control:'opencode-variant',runtimeRequired:true,status:'unverified'});
        export const verifiedThinkingCapability=(agent,model)=>agent!=='opencode'?getVerifiedThinkingCapability(provider(agent),model):model==='opencode/known'
          ?{levels:['low','high'],control:'opencode-variant',runtimeRequired:true,status:'available',provenance:{source:'verified_catalog',evidence:'controlled fixture'}}
          :{levels:[],control:'opencode-variant',runtimeRequired:true,status:'unverified',reason:'Thinking support has not been verified for this model.'};
      ` }))
    } }],
    alias: { react: `${root}/packages/web/node_modules/react`, "react-dom": `${root}/node_modules/react-dom`, "@background-agents/sdk/thinking": `${root}/packages/sdk/src/thinking.ts` },
    bundle: true, platform: "browser", write: false, define: { "process.env.NODE_ENV": '"development"' },
  })
  bundle = built.outputFiles[0].text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })

async function mount(props: Record<string, unknown> = {}, saved?: string, initialResponse?: Record<string, unknown>): Promise<Page> {
  const page = await browser.newPage()
  await page.route("https://thinking.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.goto("https://thinking.test/")
  const initial = { agent: "opencode", model: "opencode/known", readinessKey: "ready", ...props }
  await page.evaluate(({ initial, saved, initialResponse }) => {
    Object.assign(window, { initialProps: initial, initialResponse })
    if (saved) localStorage.setItem(`backgrounder-thinking:${JSON.stringify([initial.agent, initial.model])}`, saved)
  }, { initial, saved, initialResponse })
  await page.addScriptTag({ content: bundle })
  await settle(page)
  return page
}
async function settle(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function snapshot(page: Page) { return page.evaluate(() => (window as unknown as { harness: Harness }).harness.result) }

describe("thinking discovery and explicit preference recovery", () => {
  it("offers verified controls on the first prompt without provisioning a sandbox", async () => {
    const page = await mount({}, "high")
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true, capability: { levels: ["low", "high"] } })
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(0)
    await page.close()
  })
  it("uses recorded Codex choices before the first prompt, but does not invent Claude or legacy Codex evidence", async () => {
    const codex = await mount({ agent: "codex", model: "gpt-6.1-sol" }, "high")
    expect(await snapshot(codex)).toMatchObject({ thinking: "high", ready: true, capability: { status: "available" } })
    await codex.close()
    for (const [agent, model] of [["claude-code", "sonnet"], ["codex", "gpt-5.5"]]) {
      const page = await mount({ agent, model }, "high")
      expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { status: "unverified", levels: [] } })
      expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(0)
      await page.close()
    }
  })
  it.each([["codex", "gpt-6.1-sol"], ["claude-code", "sonnet"]])("checks existing %s sandbox context instead of treating static policy as verified", async (agent, model) => {
    const page = await mount({ agent, model, chatId: "chat", sandboxId: "same" }, "high", { levels: [], status: "unverified", reason: "Custom endpoint is not verified" })
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(1)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { status: "unverified", levels: [] } })
    await page.close()
  })
  it("does not look up a runtime for Eliza's known no-controls policy", async () => {
    const page = await mount({ agent: "eliza", model: "eliza-classic-1.0", chatId: "chat", sandboxId: "same" })
    expect(await snapshot(page)).toMatchObject({ ready: true, capability: { status: "no_controls", levels: [] } })
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(0)
    await page.close()
  })
  it("keeps an unverified saved choice instead of silently sending Default", async () => {
    const page = await mount({ model: "opencode/unknown" }, "high")
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { status: "unverified" } })
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.setThinking("default"))
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "default", ready: true })
    await page.close()
  })
  it("rechecks when the same sandbox becomes ready", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same", readinessKey: "stopped" }, undefined, { levels: [], status: "runtime_unavailable" })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: ["high"], status: "available", control: "opencode-variant", runtimeRequired: true })
      h.setProps({ readinessKey: "running" })
    })
    await settle(page)
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(2)
    expect((await snapshot(page)).capability.levels).toEqual(["high"])
    await page.close()
  })
  it("keeps valid catalog entries when one advertised entry is invalid", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: ["low", "bad; command", "high"], status: "available", control: "opencode-variant", runtimeRequired: true })
      h.setProps({ model: "opencode/other" })
    })
    await settle(page)
    expect((await snapshot(page)).capability.levels).toEqual(["low", "high"])
    await page.close()
  })
  it("keeps the selected effort and a retry action after lookup fails", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, "high")
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse("failure")
      h.recheckThinking?.()
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", capability: { status: "check_failed" } })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: [], status: "no_controls", reason: "No adjustable controls" })
      h.recheckThinking?.()
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { status: "no_controls" } })
    await page.close()
  })
  it("retains an incompatible recovery request until the user deliberately reselects", async () => {
    const page = await mount()
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.requestThinking?.("budget:1024"))
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "budget:1024", ready: false })
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.setThinking("low"))
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "low", ready: true })
    await page.close()
  })
  it("does not poll a resolved catalog on ordinary turn lifecycle updates", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" })
    for (const readinessKey of ["creating", "running", "ready"]) {
      await page.evaluate(readinessKey => (window as unknown as { harness: Harness }).harness.setProps({ readinessKey }), readinessKey)
      await settle(page)
    }
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(1)
    await page.close()
  })
  it.each(["running", "ready"])("immediately replaces an old Codex runtime diagnosis at the same-ID %s hint", async readinessKey => {
    const page = await mount({ agent: "codex", model: "gpt-6.1-sol", chatId: "chat", sandboxId: "same", readinessKey: "creating", isStarting: true }, "high",
      { levels: [], status: "unverified", runtimeVersion: "0.157.1", reason: "Old runtime is not verified" })
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { status: "unverified" } })
    await page.evaluate(readinessKey => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: ["low", "high"], status: "available", runtimeVersion: "0.159.3" })
      h.setProps({ readinessKey, isStarting: false })
    }, readinessKey)
    await settle(page)
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(2)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true, capability: { status: "available", levels: ["low", "high"] } })
    await page.close()
  })
  it.each(["available", "no_controls"])("rechecks %s observed during startup once preparation finishes, without waiting for stale time", async status => {
    const page = await mount({ chatId: "chat", sandboxId: "same", readinessKey: "creating", isStarting: true }, "high",
      { levels: status === "available" ? ["low"] : [], status })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: ["low", "high"], status: "available" })
      h.setProps({ readinessKey: "running:session-one", isStarting: false })
    })
    await settle(page)
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(2)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true, capability: { levels: ["low", "high"] } })
    for (const props of [
      { readinessKey: "ready", isStarting: false },
      { readinessKey: "creating", isStarting: true },
      { readinessKey: "running:session-two", isStarting: false },
    ]) {
      await page.evaluate(props => (window as unknown as { harness: Harness }).harness.setProps(props), props)
      await settle(page)
    }
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(2)
    await page.close()
  })
  it.each(["available", "no_controls"])("revalidates a stale %s catalog after a startup hint without treating chat status as sandbox state", async status => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, undefined, { levels: status === "available" ? ["low"] : [], status })
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.setProps({ readinessKey: "creating", isStarting: true }))
    await settle(page)
    await page.evaluate(() => {
      const now = Date.now()
      Date.now = () => now + 61_000
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: ["high"], status: "available" })
      h.setProps({ readinessKey: "running", isStarting: false })
    })
    await settle(page)
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(2)
    expect((await snapshot(page)).capability.levels).toEqual(["high"])
    await page.close()
  })
  it.each(["available", "no_controls"])("refreshes stale %s across an external same-ID restart while the chat stays ready", async status => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, undefined, { levels: status === "available" ? ["low"] : [], status })
    await page.evaluate(() => {
      const now = Date.now()
      Date.now = () => now + 61_000
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: [], status: "runtime_unavailable" })
      h.onThinkingMenuOpen?.()
    })
    await settle(page)
    expect((await snapshot(page)).capability.status).toBe("runtime_unavailable")
    await page.evaluate(() => {
      const now = Date.now()
      Date.now = () => now + 6_000
      ;(window as unknown as { harness: Harness }).harness.setResponse({ levels: ["high"], status: "available" })
      window.dispatchEvent(new Event("focus"))
    })
    await settle(page)
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(3)
    expect((await snapshot(page)).capability.levels).toEqual(["high"])
    await page.close()
  })
  it.each([
    { status: "available", levels: [] },
    { status: "no_controls", levels: ["high"] },
  ])("treats contradictory catalog metadata as a failed check ($status)", async response => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, "high", response)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true, capability: { status: "check_failed", levels: ["low", "high"] } })
    await page.close()
  })
  it("ignores a late response from the previous model", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      window.fetch = () => new Promise(resolve => Object.assign(window, { finishOldLookup: () => resolve(new Response(JSON.stringify({ levels: ["high"], status: "available" }))) }))
      h.recheckThinking?.()
    })
    await settle(page)
    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({ levels: ["low"], status: "available" }))
      ;(window as unknown as { harness: Harness }).harness.setProps({ model: "opencode/other" })
    })
    await settle(page)
    await page.evaluate(() => (window as unknown as { finishOldLookup: () => void }).finishOldLookup())
    await settle(page)
    expect((await snapshot(page)).capability.levels).toEqual(["low"])
    await page.close()
  })
  it("finishes a manual retry interrupted by a turn transition instead of leaving Checking stuck", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" })
    await page.evaluate(() => {
      window.fetch = () => new Promise(resolve => Object.assign(window, { finishInterruptedLookup: () => resolve(new Response(JSON.stringify({ levels: ["low"], status: "available" }))) }))
      ;(window as unknown as { harness: Harness }).harness.recheckThinking?.()
    })
    await settle(page)
    expect((await snapshot(page)).checking).toBe(true)
    await page.evaluate(() => {
      window.fetch = async () => new Response(JSON.stringify({ levels: ["high"], status: "available" }))
      ;(window as unknown as { harness: Harness }).harness.setProps({ readinessKey: "running:new-session" })
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ checking: false, capability: { levels: ["high"] } })
    await page.evaluate(() => (window as unknown as { finishInterruptedLookup: () => void }).finishInterruptedLookup())
    await settle(page)
    expect((await snapshot(page)).capability.levels).toEqual(["high"])
    await page.close()
  })
  it("does not revive trusted choices after the runtime reports an unverified context", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, "high")
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse({ levels: [], status: "unverified", reason: "Custom route not verified" })
      h.recheckThinking?.()
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { levels: [], status: "unverified" } })
    await page.evaluate(() => {
      const h = (window as unknown as { harness: Harness }).harness
      h.setResponse("failure")
      h.recheckThinking?.()
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: false, capability: { levels: [], status: "check_failed" } })
    await page.close()
  })
  it("keeps tab-local intent when preference storage fails", async () => {
    const page = await mount()
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw Error("controlled storage unavailable") }
      ;(window as unknown as { harness: Harness }).harness.setThinking("high")
    })
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true })
    expect((await snapshot(page)).notice).toContain("could not be saved")
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.setProps({ model: "opencode/unknown" }))
    await settle(page)
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.setProps({ model: "opencode/known" }))
    await settle(page)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true })
    await page.close()
  })
  it("bounds opportunistic menu/focus retries without a background polling loop", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, undefined, { levels: [], status: "runtime_unavailable" })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.evaluate(() => {
        const original = Date.now()
        Date.now = () => original + 6_000
        const h = (window as unknown as { harness: Harness }).harness
        h.onThinkingMenuOpen?.()
      })
      await settle(page)
    }
    expect(await page.evaluate(() => (window as unknown as { harness: Harness }).harness.fetches)).toBe(3)
    await page.close()
  })
  it("ends a hung lookup without discarding a valid previously selected setting", async () => {
    const page = await mount({ chatId: "chat", sandboxId: "same" }, "high")
    await page.clock.install()
    await page.evaluate(() => {
      window.fetch = () => new Promise(() => {})
      ;(window as unknown as { harness: Harness }).harness.recheckThinking?.()
    })
    await page.clock.runFor(THINKING_BROWSER_TIMEOUT_MS + 100)
    expect(await snapshot(page)).toMatchObject({ thinking: "high", ready: true, checking: false, capability: { status: "check_failed" } })
    await page.close()
  })
})
