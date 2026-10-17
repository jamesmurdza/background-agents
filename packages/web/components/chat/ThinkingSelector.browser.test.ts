import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { build } from "esbuild"
import { chromium, type Browser } from "playwright"
import { fileURLToPath } from "node:url"
import type { ThinkingCapability } from "@background-agents/sdk/thinking"

// Actual React/Radix interaction with controlled capability props, no provider.
let browser: Browser
let bundle: string
const root = fileURLToPath(new URL("../../../../", import.meta.url))
beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import * as React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ThinkingSelector} from './packages/web/components/chat/ThinkingSelector';
      function App(){
        const [props,setProps]=React.useState(window.initial);
        const [value,setValue]=React.useState(props.value??'default');
        window.update=next=>setProps(old=>({...old,...next}));
        return <ThinkingSelector {...props} value={value} onChange={v=>{window.changed=v;setValue(v)}}
          onRetry={props.retry===false?undefined:()=>window.retries=(window.retries??0)+1}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    alias: { "@": `${root}/packages/web`, react: `${root}/packages/web/node_modules/react`, "react-dom": `${root}/node_modules/react-dom`, "@background-agents/sdk/thinking": `${root}/packages/sdk/src/thinking.ts` },
    bundle: true, platform: "browser", write: false, define: { "process.env.NODE_ENV": '"development"' },
  })
  bundle = result.outputFiles[0].text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })

async function mount(capability: ThinkingCapability, extras: { value?: string; checking?: boolean; retry?: boolean } = {}) {
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.evaluate(initial => Object.assign(window, { initial }), { capability, ...extras })
  await page.addScriptTag({ content: bundle })
  await page.getByRole("combobox", { name: "Thinking level" }).click()
  return page
}

describe("thinking help and discovery retry (controlled browser)", () => {
  it("keeps Default help in a native tooltip and accessible description, not a menu paragraph", async () => {
    const page = await mount({ status: "available", levels: ["low", "high"] })
    const option = page.getByRole("option", { name: "Default", exact: true })
    expect(await option.getAttribute("title")).toContain("Default uses")
    expect(await page.getByRole("listbox").locator("p").count()).toBe(0)
    await page.keyboard.press("Escape")
    const trigger = page.getByRole("combobox", { name: "Thinking level" })
    const helpId = await trigger.getAttribute("aria-describedby")
    expect(await page.locator(`[id="${helpId}"]`).textContent()).toContain("Default uses")
    await trigger.focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.activeElement?.textContent === "Default")
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(() => document.activeElement?.textContent === "Low")
    await page.keyboard.press("Enter")
    await trigger.filter({ hasText: "Low" }).waitFor()
    expect(await trigger.textContent()).toContain("Low")
    await page.close()
  })

  it.each(["available", "no_controls"] as const)("does not offer manual retry for resolved %s", async status => {
    const page = await mount({ status, levels: status === "available" ? ["low"] : [] }, { value: "high" })
    expect(await page.getByRole("button", { name: "Check again" }).count()).toBe(0)
    await page.close()
  })

  it.each(["unverified", "runtime_unavailable", "check_failed", undefined] as const)("keeps recovery available for %s", async status => {
    const page = await mount({ status, levels: [], reason: "Cannot verify this runtime yet." })
    expect(await page.getByRole("listbox").locator("p").textContent()).toContain("Cannot verify")
    await page.getByRole("button", { name: "Check again" }).click()
    expect(await page.evaluate(() => Reflect.get(window, "retries"))).toBe(1)
    expect(await page.evaluate(() => Reflect.get(window, "changed"))).toBeUndefined()
    await page.close()
  })

  it("disables retry during checking and removes it after recovery without changing the selection", async () => {
    const page = await mount({ status: "check_failed", levels: ["low", "high"] }, { value: "high", checking: true })
    expect(await page.getByRole("button", { name: "Checking…" }).isDisabled()).toBe(true)
    await page.evaluate(() => Reflect.get(window, "update")({ capability: { status: "available", levels: ["low", "high"] }, checking: false }))
    await page.getByRole("button", { name: "Checking…" }).waitFor({ state: "detached" })
    expect(await page.getByRole("button", { name: "Check again" }).count()).toBe(0)
    expect(await page.getByRole("option", { name: "High", exact: true }).getAttribute("aria-selected")).toBe("true")
    await page.close()
  })

  it("never shows a retry button without an action", async () => {
    const page = await mount({ status: "unverified", levels: [] }, { retry: false })
    expect(await page.getByRole("button", { name: "Check again" }).count()).toBe(0)
    await page.close()
  })
})
