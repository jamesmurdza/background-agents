# @upstream/claude-credentials

Claude Code OAuth credential generation via [ccauth](https://github.com/synacktraa/ccauth) and Daytona.

## Overview

This package provides automated generation of Claude Code OAuth credentials from claude.ai session cookies. It runs the ccauth tool inside an ephemeral Daytona sandbox with a persistent volume for Cloudflare Turnstile trust accumulation.

## Installation

```bash
npm install @upstream/claude-credentials
```

## Usage

```typescript
import { generateClaudeCredentials } from "@upstream/claude-credentials"

// Generate credentials from claude.ai cookies
const cookies = '...' // Your claude.ai session cookies JSON
const credentials = await generateClaudeCredentials(cookies, {
  apiKey: process.env.DAYTONA_API_KEY,
})

// Use credentials with Claude Code
// credentials.claudeAiOauth contains accessToken, refreshToken, expiresAt, etc.
```

## How It Works

1. Resolves the latest ccauth commit SHA from GitHub
2. Creates a Daytona sandbox with the ccauth image (Debian + Chrome + patchright)
3. Mounts a persistent volume for Turnstile trust signal accumulation
4. Uploads cookies and runs `ccauth --cookies <path>` with xvfb
5. Parses and returns the OAuth credentials JSON
6. Cleans up the ephemeral sandbox

## Exports

### Types

```typescript
import type { ClaudeOAuthCredentials } from "@upstream/claude-credentials"

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
} from "@upstream/claude-credentials"
```

### Functions

```typescript
import {
  generateClaudeCredentials, // Main entry point
  resolveLatestCCAuthSha,    // Get latest ccauth commit SHA
  getCCAuthImage,            // Build Daytona Image spec
  isClaudeOAuthCredentials,  // Type guard
} from "@upstream/claude-credentials"
```

## Requirements

- Node.js >= 18
- `DAYTONA_API_KEY` environment variable (or passed via options)

## License

MIT
