import type { Sandbox } from "@daytonaio/sdk"
import { PATHS } from "@background-agents/common"
import { PICKER_MESSAGE_PREFIX } from "@/lib/element-picker"

/**
 * The sandbox side of "Select element" (see lib/element-picker.ts). The scripts
 * are strings uploaded on first use, like the terminal's PTY server.
 */

const DIR = `${PATHS.SANDBOX_HOME}/.element-picker`
const PROXY_FILE = `${DIR}/proxy.cjs`
const PICKER_PATH = "/__backgrounder/element-picker.js"

/** Outside the 3000–9999 range the Live Preview scans, so it isn't listed as a dev server. */
export function pickerPort(devServerPort: number): number {
  return devServerPort + 10000
}

export type StartPickerResult = { state: "ready" } | { state: "failed"; log: string }

/** Start the proxy for a dev server port, unless it's already running. */
export async function startElementPicker(
  sandbox: Sandbox,
  devServerPort: number
): Promise<StartPickerResult> {
  const port = pickerPort(devServerPort)
  const isUp = `curl -sf -o /dev/null --max-time 2 http://127.0.0.1:${port}${PICKER_PATH}`
  const running = await sandbox.process.executeCommand(isUp, undefined, undefined, 10)
  if (running.exitCode === 0) return { state: "ready" }

  await sandbox.process.executeCommand(`mkdir -p ${DIR}`, undefined, undefined, 10)
  await sandbox.fs.uploadFile(Buffer.from(getProxyCode()), PROXY_FILE)

  // Only `setsid` is backgrounded, so the call returns (see buildLaunchCommand
  // in dev-servers.ts). The proxy listens within a moment or fails right away.
  const log = `${DIR}/proxy-${port}.log`
  const started = await sandbox.process.executeCommand(
    `{ setsid node ${PROXY_FILE} ${devServerPort} ${port} < /dev/null > ${log} 2>&1 & } ; ` +
      `for i in $(seq 20); do ${isUp} && exit 0; sleep 0.25; done; tail -n 20 ${log}; exit 1`,
    undefined,
    undefined,
    15
  )
  return started.exitCode === 0 ? { state: "ready" } : { state: "failed", log: started.result ?? "" }
}

/** Runs in the preview page. Kept free of backticks and "${" so it fits in this template. */
function getPickerCode(): string {
  return String.raw`;(() => {
  if (window.parent === window || window.__backgrounderElementPicker) return
  window.__backgrounderElementPicker = true

  const PREFIX = ${JSON.stringify(PICKER_MESSAGE_PREFIX)}
  // Learned from the panel's first message, so element details only go to it.
  let panelOrigin = null
  let active = false

  const outline = document.createElement("div")
  Object.assign(outline.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid #3b82f6",
    background: "rgba(59, 130, 246, 0.12)",
    borderRadius: "2px",
    display: "none",
  })
  // A style element rather than a style on <html>: React would report a
  // changed <html> as a hydration mismatch.
  const cursor = document.createElement("style")

  const send = (message) => panelOrigin && window.parent.postMessage(message, panelOrigin)
  const clip = (text, max) => (text.length > max ? text.slice(0, max - 1) + "…" : text)

  function selectorFor(el) {
    const parts = []
    for (let node = el; node && node !== document.body && parts.length < 4; node = node.parentElement) {
      const tag = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(tag + "#" + node.id)
        break
      }
      const classes = [...node.classList].filter((c) => !c.includes(":")).slice(0, 2)
      parts.unshift(classes.length ? tag + "." + classes.join(".") : tag)
    }
    // <body> itself has no path below it.
    return parts.join(" > ") || el.tagName.toLowerCase()
  }

  // The opening tag and the text; nested markup isn't needed to find it.
  function htmlFor(el) {
    const tag = el.tagName.toLowerCase()
    const attrs = [...el.attributes]
      .map((a) => " " + a.name + (a.value ? '="' + clip(a.value, 80) + '"' : ""))
      .join("")
    const text = clip((el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " "), 80)
    return "<" + tag + attrs + ">" + (text ? text + "</" + tag + ">" : "")
  }

  function setActive(on) {
    active = on
    outline.style.display = "none"
    cursor.textContent = on ? "* { cursor: crosshair !important; }" : ""
  }

  document.addEventListener("mousemove", (event) => {
    if (!active || !(event.target instanceof Element)) return
    const rect = event.target.getBoundingClientRect()
    Object.assign(outline.style, {
      display: "block",
      top: rect.top + "px",
      left: rect.left + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    })
  }, true)

  document.addEventListener("click", (event) => {
    if (!active || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.target.getBoundingClientRect()
    send({
      type: PREFIX + "selected",
      element: {
        path: location.pathname,
        html: htmlFor(event.target),
        selector: selectorFor(event.target),
        rect: { top: rect.top, left: rect.left, bottom: rect.bottom },
      },
    })
  }, true)

  document.addEventListener("keydown", (event) => {
    if (active && event.key === "Escape") send({ type: PREFIX + "exit" })
  })

  // The outline is fixed to where the element was, so scrolling makes it point
  // at the wrong place. Once per scroll: it stays hidden until the mouse moves.
  document.addEventListener("scroll", () => {
    if (!active || outline.style.display === "none") return
    outline.style.display = "none"
    send({ type: PREFIX + "deselect" })
  }, true)

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.type !== PREFIX + "toggle") return
    panelOrigin = event.origin
    setActive(Boolean(event.data.on))
  })

  const start = () => {
    document.body.appendChild(outline)
    document.head.appendChild(cursor)
    window.parent.postMessage({ type: PREFIX + "ready" }, "*")
  }
  if (document.body) start()
  else document.addEventListener("DOMContentLoaded", start)
})()
`
}

/** `node proxy.cjs <dev server port> <proxy port>`. Same constraints as the picker. */
export function getProxyCode(): string {
  return String.raw`const http = require("node:http")
const net = require("node:net")

const [target, port] = process.argv.slice(2).map(Number)
const PICKER_PATH = ${JSON.stringify(PICKER_PATH)}
const PICKER_SCRIPT = ${JSON.stringify(getPickerCode())}
const PICKER_TAG = '<script src="' + PICKER_PATH + '"></script>'

// Dev servers only accept requests for their own host (Vite's allowedHosts,
// Next's allowedDevOrigins), so present every request as a local one. Node
// tries both IPv4 and IPv6 for "localhost", which Vite's ::1 default needs.
const upstreamHeaders = (headers) => ({
  ...headers,
  host: "localhost:" + target,
  ...(headers.origin && { origin: "http://localhost:" + target }),
})

function badGateway(res, error) {
  if (res.headersSent) return res.destroy()
  res.writeHead(502, { "content-type": "text/plain" })
  res.end("The dev server on port " + target + " isn't responding: " + error.message)
}

const server = http.createServer((req, res) => {
  if (req.url === PICKER_PATH) {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" })
    return res.end(PICKER_SCRIPT)
  }
  const wantsHtml = String(req.headers.accept ?? "").includes("text/html")
  const upstream = http.request(
    {
      host: "localhost",
      port: target,
      method: req.method,
      path: req.url,
      // Ask for plain HTML so the picker can be added to it.
      headers: { ...upstreamHeaders(req.headers), ...(wantsHtml && { "accept-encoding": "identity" }) },
    },
    (up) => {
      const headers = { ...up.headers }
      // A strict CSP would block the picker. Dev servers rarely set one.
      delete headers["content-security-policy"]
      if (!String(headers["content-type"] ?? "").includes("text/html") || headers["content-encoding"]) {
        res.writeHead(up.statusCode ?? 502, headers)
        return up.pipe(res)
      }
      const chunks = []
      up.on("data", (chunk) => chunks.push(chunk))
      up.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8")
        const body = html.includes("</head>") ? html.replace("</head>", PICKER_TAG + "</head>") : PICKER_TAG + html
        delete headers["content-length"]
        delete headers["transfer-encoding"]
        // A cached page would hide the agent's latest change after a reload.
        headers["cache-control"] = "no-store"
        res.writeHead(up.statusCode ?? 200, headers)
        res.end(body)
      })
    }
  )
  upstream.on("error", (error) => badGateway(res, error))
  req.pipe(upstream)
})

// Live reload runs over a websocket; pass upgrades straight through.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(target, "localhost", () => {
    const lines = Object.entries(upstreamHeaders(req.headers)).map(([key, value]) => key + ": " + value)
    upstream.write(req.method + " " + req.url + " HTTP/1.1\r\n" + lines.join("\r\n") + "\r\n\r\n")
    upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  upstream.on("error", () => socket.destroy())
  socket.on("error", () => upstream.destroy())
})

server.listen(port, "0.0.0.0", () => console.log("Element picker: port " + port + " -> dev server on " + target))
`
}
