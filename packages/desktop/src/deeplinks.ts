import { app } from "electron";
import path from "node:path";

const PROTOCOL = "background-agents";

export function setupDeepLinks(handler: (url: string) => void) {
  // Register protocol handler
  if (process.defaultApp) {
    // Development: register electron + the app script as the launch command.
    // Use an ABSOLUTE script path — the OS launches the protocol handler from
    // an arbitrary working directory, so a relative `process.argv[1]` (e.g.
    // "dist/main.js" when started via `electron dist/main.js`) fails to resolve
    // and Windows reports "error launching app with path".
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    // Production: just register the protocol
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // Handle URLs passed via command line (Windows/Linux launch)
  const deepLinkArg = process.argv.find((arg) =>
    arg.startsWith(`${PROTOCOL}://`)
  );
  if (deepLinkArg) {
    // Delay to ensure window is ready
    app.whenReady().then(() => {
      setTimeout(() => handler(deepLinkArg), 100);
    });
  }
}
