import { NextRequest, NextResponse } from "next/server"

/**
 * Electron OAuth Callback Handler
 *
 * After GitHub OAuth completes, this endpoint redirects to the custom protocol
 * to bring focus back to the Electron app.
 *
 * Flow:
 * 1. User clicks sign in, SignInModal sets callbackUrl to /api/auth/electron-callback
 * 2. User completes GitHub OAuth in browser
 * 3. NextAuth callback sets session cookies, redirects to this endpoint
 * 4. This route returns HTML that redirects to background-agents://auth-callback
 * 5. Electron catches the deep link and reloads to pick up the session
 *
 * We use an HTML page with JavaScript redirect because NextResponse.redirect()
 * may not work with custom protocols in all browsers.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const callbackUrl = searchParams.get("callbackUrl") || "/"

  // Redirect to Electron app via custom protocol
  const electronUrl = `background-agents://auth-callback?success=true&callbackUrl=${encodeURIComponent(callbackUrl)}`

  // Return HTML page that redirects to the custom protocol
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Redirecting to Background Agents...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0a0a0a;
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
    p {
      color: #888;
      margin-bottom: 2rem;
    }
    a {
      color: #3b82f6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✓ Signed in successfully!</h1>
    <p>Redirecting to Background Agents app...</p>
    <p><a href="${electronUrl}">Click here if you're not redirected automatically</a></p>
  </div>
  <script>
    // Redirect to Electron app
    window.location.href = "${electronUrl}";
  </script>
</body>
</html>
`

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}
