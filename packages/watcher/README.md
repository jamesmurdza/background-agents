# File Watcher SDK

A TypeScript SDK for monitoring file changes in [Daytona](https://daytona.io) sandboxes. Query for recently modified files and read their contents on demand.

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createWatcher } from "@upstream/watcher"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

const watcher = createWatcher(sandbox, {
  path: "/home/daytona/project/src",
  extensions: [".ts", ".tsx"],
})

// Get files modified in the last 30 seconds
const { files } = await watcher.getModifiedFiles({ since: 30 })

// Read content of a specific file
const { content } = await watcher.readFile(files[0].path)

await sandbox.delete()
```

---

## Features

- **Simple pull-based API** — Query for modified files on demand, no background processes
- **File type filtering** — Watch only specific extensions (`.ts`, `.js`, `.json`, etc.)
- **Ignore patterns** — Skip `node_modules`, `.git`, `dist`, and other directories
- **Efficient queries** — Uses `find` and `stat` for fast filesystem queries
- **Read on demand** — Get file contents only when you need them

---

## Prerequisites

A [Daytona](https://daytona.io) API key for sandboxed execution.

```bash
export DAYTONA_API_KEY=dtn_your_api_key
```

---

## Installation

```bash
npm install @upstream/watcher @daytonaio/sdk
```

---

## Quick start

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createWatcher } from "@upstream/watcher"

// 1. Create sandbox
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// 2. Create watcher
const watcher = createWatcher(sandbox, {
  path: "/home/daytona/project/src",
  extensions: [".ts", ".tsx", ".js"],
  ignore: ["node_modules", ".git", "dist"],
})

// 3. Query for modified files
const { files, queriedAt } = await watcher.getModifiedFiles({ since: 60 })
console.log(`Found ${files.length} files modified in the last 60 seconds`)

// 4. Read file contents
for (const file of files) {
  const { content, modifiedAt, size } = await watcher.readFile(file.path)
  console.log(`${file.path} (${size} bytes, modified ${modifiedAt})`)
  console.log(content)
}

// 5. Cleanup
await sandbox.delete()
```

---

## API reference

### `createWatcher(sandbox, options)`

Creates a file watcher for a sandbox.

```typescript
const watcher = createWatcher(sandbox, {
  path: "/home/daytona/project/src",  // Directory to watch (required)
  extensions: [".ts", ".tsx"],         // File extensions (default: .ts, .tsx, .js, .jsx, .json)
  ignore: ["node_modules", ".git"],    // Directories to ignore (default: node_modules, .git, dist, build, .next, __pycache__)
})
```

### `watcher.getModifiedFiles(options)`

Query for files modified within a time window.

```typescript
const { files, queriedAt } = await watcher.getModifiedFiles({
  since: 30,  // Seconds ago (required)
})

// files: ModifiedFile[] - list of modified files
// queriedAt: Date - when the query was executed
```

### `watcher.readFile(path, options?)`

Read the contents of a specific file.

```typescript
const { path, content, modifiedAt, size } = await watcher.readFile(
  "/home/daytona/project/src/index.ts",
  { maxSize: 1024 * 1024 }  // Optional: max file size in bytes (default: 1MB)
)
```

### `watcher.readFiles(paths, options?)`

Read multiple files at once. Failed reads are silently skipped.

```typescript
const contents = await watcher.readFiles([
  "/home/daytona/project/src/index.ts",
  "/home/daytona/project/src/utils.ts",
])
```

---

## Types

### `ModifiedFile`

```typescript
interface ModifiedFile {
  path: string       // Absolute path to the file
  modifiedAt: Date   // When the file was last modified
  size: number       // File size in bytes
}
```

### `FileContent`

```typescript
interface FileContent {
  path: string       // Absolute path to the file
  content: string    // File contents as a string
  modifiedAt: Date   // When the file was last modified
  size: number       // File size in bytes
}
```

### `WatcherOptions`

```typescript
interface WatcherOptions {
  path: string           // Directory to watch (required)
  extensions?: string[]  // File extensions to include (default: [".ts", ".tsx", ".js", ".jsx", ".json"])
  ignore?: string[]      // Directory names to ignore (default: ["node_modules", ".git", "dist", "build", ".next", "__pycache__"])
}
```

---

## Use cases

### Monitor agent file edits

Track which files an AI coding agent has modified:

```typescript
import { createSession } from "@upstream/agents"
import { createWatcher } from "@upstream/watcher"

const session = await createSession("claude", { sandbox, env: { ... } })
const watcher = createWatcher(sandbox, { path: "/home/daytona/project" })

await session.start("Refactor the auth module")

// Poll for agent events and file changes
while (await session.isRunning()) {
  const { events } = await session.getEvents()
  const { files } = await watcher.getModifiedFiles({ since: 5 })

  for (const file of files) {
    console.log(`Modified: ${file.path}`)
  }

  await new Promise(r => setTimeout(r, 2000))
}
```

### Build a file diff viewer

Show what changed in recently modified files:

```typescript
const { files } = await watcher.getModifiedFiles({ since: 60 })
const contents = await watcher.readFiles(files.map(f => f.path))

for (const file of contents) {
  console.log(`\n--- ${file.path} ---`)
  console.log(file.content)
}
```

---

## Debug mode

Set `WATCHER_DEBUG=1` to enable debug logging:

```bash
WATCHER_DEBUG=1 npx tsx your-script.ts
```

---

## Development

```bash
npm install
npm run build
npm test

# Integration tests (requires Daytona API key)
DAYTONA_API_KEY=... npm test -- tests/integration/watcher.test.ts
```

---

## License

MIT
