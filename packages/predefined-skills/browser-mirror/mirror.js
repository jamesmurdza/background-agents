const express = require("express");
const { WebSocketServer } = require("ws");
const { chromium } = require("playwright");
const http = require("http");

const PORT = 4502;
const VIEWPORT = { width: 1280, height: 800 };

const app = express();

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

server.listen(PORT, () => {
  console.log(`Mirror page: http://localhost:${PORT}`);
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

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

  console.log("Starting automated actions (looping)...");

  while (true) {
    await page.goto("https://example.com");
    await page.waitForTimeout(2000);

    await page.goto("https://news.ycombinator.com");
    await page.waitForTimeout(2000);

    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(800);
    }

    const firstLink = page.locator(".titleline > a").first();
    const title = await firstLink.textContent().catch(() => null);
    console.log("Clicking first story:", title);
    await firstLink.click().catch(() => {});
    await page.waitForTimeout(3000);

    await page.goBack().catch(() => {});
    await page.waitForTimeout(2000);

    console.log("Loop iteration complete, restarting...");
  }
})();
