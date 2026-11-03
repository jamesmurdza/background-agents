import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import http from "node:http"
import net, { type AddressInfo } from "node:net"
import vm from "node:vm"
import type { Duplex } from "node:stream"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getProxyCode } from "./element-picker-sandbox"
import { PICKER_MESSAGE_PREFIX } from "./element-picker"

// A stand-in dev server. It listens on ::1 only, like Vite by default, so the
// proxy's IPv4-then-IPv6 lookup is covered too.
let lastRequest: http.IncomingHttpHeaders = {}
const devServer = http.createServer((req, res) => {
  lastRequest = req.headers
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'none'" })
    return res.end("<html><head><title>App</title></head><body>Hi</body></html>")
  }
  res.writeHead(200, { "content-type": "text/javascript" })
  res.end("console.log('app')")
})
// Echoes whatever comes over an upgraded connection, like a live-reload socket.
devServer.on("upgrade", (_req, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
  socket.on("data", (data) => socket.write(data))
})

let target: number
let proxy: ChildProcess
let proxyUrl: string

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

beforeAll(async () => {
  await new Promise<void>((resolve) => devServer.listen(0, "::1", resolve))
  target = (devServer.address() as AddressInfo).port
  const port = await freePort()
  const file = join(mkdtempSync(join(tmpdir(), "element-picker-")), "proxy.cjs")
  writeFileSync(file, getProxyCode())
  proxy = spawn(process.execPath, [file, String(target), String(port)])
  await new Promise<void>((resolve, reject) => {
    proxy.stdout!.on("data", (data) => String(data).includes("Element picker") && resolve())
    proxy.on("exit", (code) => reject(new Error(`proxy exited with ${code}`)))
  })
  proxyUrl = `http://127.0.0.1:${port}`
})

afterAll(() => {
  proxy?.kill()
  devServer.close()
})

describe("element picker proxy", () => {
  it("adds the picker to HTML pages, without CSP or caching", async () => {
    const res = await fetch(`${proxyUrl}/`, { headers: { accept: "text/html" } })
    expect(await res.text()).toContain(
      '<title>App</title><script src="/__backgrounder/element-picker.js"></script></head>'
    )
    expect(res.headers.get("content-security-policy")).toBeNull()
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("serves a picker script that parses", async () => {
    const res = await fetch(`${proxyUrl}/__backgrounder/element-picker.js`)
    const script = await res.text()
    expect(() => new vm.Script(script)).not.toThrow()
    expect(script).toContain(PICKER_MESSAGE_PREFIX)
  })

  it("passes other responses through unchanged", async () => {
    const res = await fetch(`${proxyUrl}/app.js`)
    expect(await res.text()).toBe("console.log('app')")
  })

  it("presents requests as coming from the dev server's own host", async () => {
    await fetch(`${proxyUrl}/app.js`, { headers: { origin: "https://13000-sandbox.daytonaproxy01.net" } })
    expect(lastRequest.host).toBe(`localhost:${target}`)
    expect(lastRequest.origin).toBe(`http://localhost:${target}`)
  })

  it("passes websocket upgrades through", async () => {
    const socket = await new Promise<Duplex>((resolve, reject) => {
      http
        .request(proxyUrl, { headers: { connection: "Upgrade", upgrade: "websocket" } })
        .on("upgrade", (_res, upgraded) => resolve(upgraded))
        .on("error", reject)
        .end()
    })
    socket.write("ping")
    const echoed = await new Promise<string>((resolve) => socket.once("data", (data) => resolve(String(data))))
    socket.destroy()
    expect(echoed).toBe("ping")
  })
})
