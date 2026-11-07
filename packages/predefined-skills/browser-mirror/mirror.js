const express = require("express");
const { WebSocketServer } = require("ws");
const { chromium } = require("playwright");
const http = require("http");

const PORT = 4502;
const VIEWPORT = { width: 1280, height: 800 };

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html>
  <head>
    <title>Browser Stream</title>
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background-color: #ddd;
        background-image:
          linear-gradient(45deg, #ccc 25%, transparent 25%),
          linear-gradient(-45deg, #ccc 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #ccc 75%),
          linear-gradient(-45deg, transparent 75%, #ccc 75%);
        background-size: 20px 20px;
        background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      img {
        max-width: 100%;
        max-height: 100vh;
        display: none;
      }
      #spinner {
        width: 48px;
        height: 48px;
        border: 5px solid rgba(0,0,0,0.15);
        border-top-color: rgba(0,0,0,0.5);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <div id="spinner"></div>
    <img id="frame" />
    <script>
      const img = document.getElementById('frame');
      const spinner = document.getElementById('spinner');
      const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(wsProtocol + location.host + '/ws');
      let shown = false;
      ws.onmessage = (ev) => {
        img.src = 'data:image/jpeg;base64,' + ev.data;
        if (!shown) {
          shown = true;
          spinner.style.display = 'none';
          img.style.display = 'block';
        }
      };
      ws.onclose = () => {
        shown = false;
        spinner.style.display = 'block';
        img.style.display = 'none';
      };
    </script>
  </body>
</html>`);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

function broadcastFrame(base64Data) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(base64Data);
  }
}

let page; // set once the browser is ready; control routes use this

// --- Control API --------------------------------------------------------
// POST /control  { "action": "...", ...params }
// Drives the same live `page` the mirror is streaming, so every action is
// visible to anyone watching the viewer page in real time.

app.post("/control", async (req, res) => {
  if (!page) return res.status(503).json({ success: false, error: "Browser not ready yet" });

  const { action, ...params } = req.body ?? {};

  try {
    switch (action) {
      case "goto": {
        if (!params.url) throw new Error("goto requires 'url'");
        await page.goto(params.url, { waitUntil: "load", timeout: 30000 });
        return res.json({ success: true, url: page.url(), title: await page.title() });
      }

      case "click": {
        if (!params.selector) throw new Error("click requires 'selector'");
        await page.click(params.selector, { timeout: params.timeout ?? 10000 });
        return res.json({ success: true });
      }

      case "type": {
        if (!params.selector || params.text == null) throw new Error("type requires 'selector' and 'text'");
        await page.fill(params.selector, String(params.text), { timeout: params.timeout ?? 10000 });
        return res.json({ success: true });
      }

      case "press": {
        if (!params.key) throw new Error("press requires 'key'");
        if (params.selector) {
          await page.focus(params.selector);
        }
        await page.keyboard.press(params.key);
        return res.json({ success: true });
      }

      case "scroll": {
        await page.mouse.wheel(params.deltaX ?? 0, params.deltaY ?? 400);
        return res.json({ success: true });
      }

      case "waitForSelector": {
        if (!params.selector) throw new Error("waitForSelector requires 'selector'");
        await page.waitForSelector(params.selector, { timeout: params.timeout ?? 10000 });
        return res.json({ success: true });
      }

      case "wait": {
        await page.waitForTimeout(params.ms ?? 1000);
        return res.json({ success: true });
      }

      case "evaluate": {
        if (!params.script) throw new Error("evaluate requires 'script' (a JS expression)");
        const result = await page.evaluate(new Function(`return (${params.script})`));
        return res.json({ success: true, result });
      }

      case "status": {
        return res.json({ success: true, url: page.url(), title: await page.title() });
      }

      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
        return res.json({ success: true, image: buffer.toString("base64") });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown action: "${action}"` });
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Mirror page: http://localhost:${PORT}`);
  console.log(`Control API: POST http://localhost:${PORT}/control`);
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: VIEWPORT });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });

  cdp.on("Page.screencastFrame", async (payload) => {
    broadcastFrame(payload.data);
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
    } catch (e) {
      // session may have ended
    }
  });

  await page.goto("about:blank");
  console.log("Browser ready. Waiting for /control commands...");
})();
