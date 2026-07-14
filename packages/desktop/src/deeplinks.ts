import { app } from "electron";

const PROTOCOL = "background-agents";

export function setupDeepLinks(handler: (url: string) => void) {
  // Register protocol handler
  if (process.defaultApp) {
    // Development: pass the script path
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1],
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
