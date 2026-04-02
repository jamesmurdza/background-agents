/**
 * Integration tests for the file watcher SDK.
 *
 * Tests file modification detection and content reading in a real Daytona sandbox.
 *
 * Required env vars:
 *   - DAYTONA_API_KEY
 *
 * Run:
 *   DAYTONA_API_KEY=... npm test -- tests/integration/watcher.test.ts
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createWatcher, type FileWatcher } from "../../src/index.js"

const DAYTONA_API_KEY =
  process.env.TEST_DAYTONA_API_KEY || process.env.DAYTONA_API_KEY

const TEST_DIR = "/home/daytona/test-watcher"

describe.skipIf(!DAYTONA_API_KEY)("file watcher integration tests", () => {
  let daytona: Daytona
  let sandbox: Sandbox
  let watcher: FileWatcher

  beforeAll(async () => {
    daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
    sandbox = await daytona.create()

    // Create test directory
    await sandbox.process.executeCommand(`mkdir -p ${TEST_DIR}`)

    // Create watcher
    watcher = createWatcher(sandbox, {
      path: TEST_DIR,
      extensions: [".ts", ".js", ".json"],
      ignore: ["node_modules", ".git"],
    })
  }, 60_000)

  afterAll(async () => {
    if (sandbox) {
      await sandbox.delete()
    }
  }, 30_000)

  describe("getModifiedFiles", () => {
    it("returns empty list when no files exist", async () => {
      // Clean the test directory
      await sandbox.process.executeCommand(`rm -rf ${TEST_DIR}/*`)

      const { files, queriedAt } = await watcher.getModifiedFiles({ since: 60 })

      expect(files).toEqual([])
      expect(queriedAt).toBeInstanceOf(Date)
    }, 30_000)

    it("detects newly created files", async () => {
      // Create a new file
      const testFile = `${TEST_DIR}/new-file.ts`
      await sandbox.process.executeCommand(
        `echo 'export const foo = 1;' > ${testFile}`
      )

      // Query for modified files
      const { files } = await watcher.getModifiedFiles({ since: 60 })

      expect(files.length).toBeGreaterThanOrEqual(1)
      const found = files.find((f) => f.path === testFile)
      expect(found).toBeDefined()
      expect(found!.modifiedAt).toBeInstanceOf(Date)
      expect(found!.size).toBeGreaterThan(0)
    }, 30_000)

    it("detects modified files", async () => {
      const testFile = `${TEST_DIR}/modified-file.ts`

      // Create initial file
      await sandbox.process.executeCommand(`echo 'const a = 1;' > ${testFile}`)

      // Wait a moment
      await new Promise((r) => setTimeout(r, 1000))

      // Modify the file
      await sandbox.process.executeCommand(`echo 'const a = 2;' >> ${testFile}`)

      // Query for modified files
      const { files } = await watcher.getModifiedFiles({ since: 10 })

      const found = files.find((f) => f.path === testFile)
      expect(found).toBeDefined()
    }, 30_000)

    it("filters by extension", async () => {
      // Create files with different extensions
      await sandbox.process.executeCommand(
        `echo 'ts content' > ${TEST_DIR}/test.ts`
      )
      await sandbox.process.executeCommand(
        `echo 'py content' > ${TEST_DIR}/test.py`
      )
      await sandbox.process.executeCommand(
        `echo 'js content' > ${TEST_DIR}/test.js`
      )

      const { files } = await watcher.getModifiedFiles({ since: 60 })

      // Should include .ts and .js but not .py
      const paths = files.map((f) => f.path)
      expect(paths.some((p) => p.endsWith(".ts"))).toBe(true)
      expect(paths.some((p) => p.endsWith(".js"))).toBe(true)
      expect(paths.some((p) => p.endsWith(".py"))).toBe(false)
    }, 30_000)

    it("respects the since parameter", async () => {
      // Create a file
      const testFile = `${TEST_DIR}/old-file.ts`
      await sandbox.process.executeCommand(`echo 'old' > ${testFile}`)

      // Wait 3 seconds
      await new Promise((r) => setTimeout(r, 3000))

      // Query for files modified in last 1 second (should not include our file)
      const { files } = await watcher.getModifiedFiles({ since: 1 })

      const found = files.find((f) => f.path === testFile)
      expect(found).toBeUndefined()
    }, 30_000)

    it("ignores specified directories", async () => {
      // Create a file in an ignored directory
      await sandbox.process.executeCommand(`mkdir -p ${TEST_DIR}/node_modules`)
      await sandbox.process.executeCommand(
        `echo 'ignored' > ${TEST_DIR}/node_modules/package.ts`
      )

      // Create a file in a non-ignored directory
      await sandbox.process.executeCommand(`mkdir -p ${TEST_DIR}/src`)
      await sandbox.process.executeCommand(
        `echo 'included' > ${TEST_DIR}/src/index.ts`
      )

      const { files } = await watcher.getModifiedFiles({ since: 60 })

      const paths = files.map((f) => f.path)
      expect(paths.some((p) => p.includes("node_modules"))).toBe(false)
      expect(paths.some((p) => p.includes("src/index.ts"))).toBe(true)
    }, 30_000)
  })

  describe("readFile", () => {
    it("reads file content correctly", async () => {
      const testFile = `${TEST_DIR}/read-test.ts`
      const content = 'export const message = "hello world";'
      await sandbox.process.executeCommand(`echo '${content}' > ${testFile}`)

      const result = await watcher.readFile(testFile)

      expect(result.path).toBe(testFile)
      expect(result.content.trim()).toBe(content)
      expect(result.modifiedAt).toBeInstanceOf(Date)
      expect(result.size).toBeGreaterThan(0)
    }, 30_000)

    it("throws error for non-existent file", async () => {
      await expect(
        watcher.readFile(`${TEST_DIR}/non-existent.ts`)
      ).rejects.toThrow()
    }, 30_000)

    it("respects maxSize option", async () => {
      const testFile = `${TEST_DIR}/large-file.ts`
      // Create a file larger than our limit
      await sandbox.process.executeCommand(
        `dd if=/dev/zero bs=1024 count=100 2>/dev/null | tr '\\0' 'a' > ${testFile}`
      )

      // Try to read with a small maxSize
      await expect(
        watcher.readFile(testFile, { maxSize: 1024 })
      ).rejects.toThrow(/too large/)
    }, 30_000)

    it("handles files with special characters in content", async () => {
      const testFile = `${TEST_DIR}/special-chars.json`
      const content = '{"key": "value with \\"quotes\\" and \\n newlines"}'
      await sandbox.process.executeCommand(
        `echo '${content}' > ${testFile}`
      )

      const result = await watcher.readFile(testFile)
      expect(result.content).toBeDefined()
      expect(result.content.length).toBeGreaterThan(0)
    }, 30_000)
  })

  describe("readFiles", () => {
    it("reads multiple files at once", async () => {
      const file1 = `${TEST_DIR}/multi-1.ts`
      const file2 = `${TEST_DIR}/multi-2.ts`
      const file3 = `${TEST_DIR}/multi-3.ts`

      await sandbox.process.executeCommand(`echo 'content 1' > ${file1}`)
      await sandbox.process.executeCommand(`echo 'content 2' > ${file2}`)
      await sandbox.process.executeCommand(`echo 'content 3' > ${file3}`)

      const results = await watcher.readFiles([file1, file2, file3])

      expect(results.length).toBe(3)
      expect(results.map((r) => r.path).sort()).toEqual(
        [file1, file2, file3].sort()
      )
    }, 30_000)

    it("skips files that fail to read", async () => {
      const file1 = `${TEST_DIR}/exists.ts`
      const file2 = `${TEST_DIR}/does-not-exist.ts`

      await sandbox.process.executeCommand(`echo 'content' > ${file1}`)

      const results = await watcher.readFiles([file1, file2])

      // Should only return the file that exists
      expect(results.length).toBe(1)
      expect(results[0].path).toBe(file1)
    }, 30_000)

    it("returns empty array when all files fail", async () => {
      const results = await watcher.readFiles([
        `${TEST_DIR}/missing-1.ts`,
        `${TEST_DIR}/missing-2.ts`,
      ])

      expect(results).toEqual([])
    }, 30_000)
  })

  describe("watcher properties", () => {
    it("exposes path, extensions, and ignore", () => {
      expect(watcher.path).toBe(TEST_DIR)
      expect(watcher.extensions).toEqual([".ts", ".js", ".json"])
      expect(watcher.ignore).toEqual(["node_modules", ".git"])
    })
  })

  describe("edge cases", () => {
    it("handles empty directory", async () => {
      const emptyDir = `${TEST_DIR}/empty-dir`
      await sandbox.process.executeCommand(`mkdir -p ${emptyDir}`)

      const emptyWatcher = createWatcher(sandbox, {
        path: emptyDir,
        extensions: [".ts"],
      })

      const { files } = await emptyWatcher.getModifiedFiles({ since: 60 })
      expect(files).toEqual([])
    }, 30_000)

    it("handles deeply nested files", async () => {
      const deepPath = `${TEST_DIR}/a/b/c/d/e`
      const deepFile = `${deepPath}/deep.ts`

      await sandbox.process.executeCommand(`mkdir -p ${deepPath}`)
      await sandbox.process.executeCommand(`echo 'deep content' > ${deepFile}`)

      const { files } = await watcher.getModifiedFiles({ since: 60 })

      const found = files.find((f) => f.path === deepFile)
      expect(found).toBeDefined()
    }, 30_000)

    it("handles files with spaces in names", async () => {
      const testFile = `${TEST_DIR}/file with spaces.ts`
      await sandbox.process.executeCommand(
        `echo 'content' > "${testFile}"`
      )

      const { files } = await watcher.getModifiedFiles({ since: 60 })

      const found = files.find((f) => f.path === testFile)
      expect(found).toBeDefined()

      // Also test reading it
      const content = await watcher.readFile(testFile)
      expect(content.content.trim()).toBe("content")
    }, 30_000)

    it("handles rapid file modifications", async () => {
      const testFile = `${TEST_DIR}/rapid.ts`

      // Rapidly modify a file
      for (let i = 0; i < 5; i++) {
        await sandbox.process.executeCommand(
          `echo 'iteration ${i}' > ${testFile}`
        )
      }

      const { files } = await watcher.getModifiedFiles({ since: 60 })

      // Should still detect the file
      const found = files.find((f) => f.path === testFile)
      expect(found).toBeDefined()
    }, 30_000)
  })
})
