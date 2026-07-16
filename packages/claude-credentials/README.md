# @background-agents/claude-credentials

Claude Code OAuth credential generation via [ccauth](https://github.com/synacktraa/ccauth) and Daytona.

## Overview

This package provides automated generation of Claude Code OAuth credentials — either from claude.ai session cookies (a full browser OAuth flow) or from an existing refresh token (a plain HTTP renewal). Both run the ccauth tool inside an ephemeral Daytona sandbox.

## Installation

```bash
npm install @background-agents/claude-credentials
```

## Usage

```typescript
import { generateClaudeCredentials } from "@background-agents/claude-credentials"

// From claude.ai cookies — full browser OAuth flow (heavy image + Turnstile).
const cookies = "..." // claude.ai session cookies JSON (Cookie-Editor export)
const credentials = await generateClaudeCredentials(
  { cookies },
  { apiKey: process.env.DAYTONA_API_KEY },
)

// From an existing refresh token — no browser, lightweight image.
const renewed = await generateClaudeCredentials(
  { refreshToken: "sk-ant-ort01-..." },
  { apiKey: process.env.DAYTONA_API_KEY },
)

// credentials.claudeAiOauth contains accessToken, refreshToken, expiresAt, etc.
```

## How It Works

1. Uses a **pinned** ccauth commit SHA (`CCAUTH_PINNED_SHA`) to build the image.
   We pin rather than resolve `master` on every run because the generator runs
   on an hourly cron and the unauthenticated GitHub API rate limit (60 req/h per
   IP) would 403. To roll ccauth forward, bump `CCAUTH_PINNED_SHA` in
   `src/generate.ts` (use `resolveLatestCCAuthSha()` to find the latest SHA).
2. Creates an ephemeral Daytona sandbox with the image for the chosen mode:
   - `{ cookies }` → heavy image (Debian + Chrome + patchright) with a persistent
     volume for Cloudflare Turnstile trust, running `ccauth --cookies` under xvfb
   - `{ refreshToken }` → lightweight image (no browser, no volume), running
     `ccauth --refresh` (a plain `grant_type=refresh_token` HTTP call)
3. Parses and returns the OAuth credentials JSON (same shape for both modes)
4. Cleans up the ephemeral sandbox

The `{ refreshToken }` form throws `RefreshTokenExpiredError` when the refresh
token is rejected, so callers can fall back to the `{ cookies }` form.

## Exports

### Types

```typescript
import type { ClaudeOAuthCredentials } from "@background-agents/claude-credentials"

// ClaudeOAuthCredentials shape:
// {
//   claudeAiOauth: {
//     accessToken: string
//     refreshToken: string
//     expiresAt: number
//     scopes: string[]
//     subscriptionType?: string
//     rateLimitTier?: string
//   }
// }
```

### Constants

```typescript
import {
  CLAUDE_CREDS_KEY,   // Database row key for cached credentials
  CLAUDE_COOKIES_KEY, // Database row key for raw cookies
} from "@background-agents/claude-credentials"
```

### Functions

```typescript
import {
  generateClaudeCredentials,        // Main entry point ({ cookies } | { refreshToken })
  CCAUTH_PINNED_SHA,                // Pinned ccauth commit the image is built from
  resolveLatestCCAuthSha,           // Manual helper: latest ccauth SHA (for bumping the pin)
  getCCAuthImage,                   // Build Daytona Image spec (sha, refreshMode?)
  isClaudeOAuthCredentials,         // Type guard
  RefreshTokenExpiredError,         // Thrown when the refresh token is expired/revoked
  type GenerateCredentialsOptions,  // Options for generateClaudeCredentials
} from "@background-agents/claude-credentials"
```

## Requirements

- Node.js >= 18
- `DAYTONA_API_KEY` environment variable (or passed via options)

## License

MIT
