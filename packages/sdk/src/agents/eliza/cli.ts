#!/usr/bin/env node
/**
 * ELIZA Therapist Agent CLI
 *
 * A fake agent that outputs Claude Code compatible JSON lines.
 * Uses classic ELIZA pattern matching (deterministic, not random/LLM).
 * Can create and delete actual files as "therapeutic exercises".
 *
 * Memory system (like original ELIZA):
 * - Certain patterns store a "memory response" for later recall
 * - When the fallback pattern would trigger, ELIZA recalls from memory instead
 * - Uses Write/Read tool calls for memory files, Bash for ls/rm
 */

import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { matchPattern, hashString } from "./patterns.js"

// Configuration from environment
const sessionId = process.env.ELIZA_SESSION_ID || `eliza-${randomUUID()}`
const cwd = process.env.ELIZA_CWD || process.cwd()
// Delay multiplier for testing (e.g., ELIZA_DELAY_MULTIPLIER=10 for 10x slower)
const delayMultiplier = Math.max(1, Number(process.env.ELIZA_DELAY_MULTIPLIER) || 1)

// Memory file prefix for storing responses to recall later
const MEMORY_PREFIX = "memory_"

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a short unique ID
 */
function generateId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12)
}

/**
 * Push a memory response to the memory stack using Write tool call.
 * Creates a timestamped memory_xxxxx.txt file in the current directory.
 */
async function pushMemory(
  memoryResponse: string,
  interEventDelay: number
): Promise<void> {
  const toolId = `toolu_${generateId()}`
  const filename = `${MEMORY_PREFIX}${Date.now()}.txt`
  const memoryFile = path.join(cwd, filename)

  // Emit Write tool_use
  await emit(
    {
      type: "assistant",
      message: {
        id: `msg_${generateId()}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: "Write",
            input: {
              file_path: memoryFile,
              content: memoryResponse,
            },
          },
        ],
      },
      session_id: sessionId,
    },
    interEventDelay
  )

  // Actually write the file
  await sleep(100)
  try {
    fs.writeFileSync(memoryFile, memoryResponse)

    await emit(
      {
        type: "user",
        message: {
          content: [
            {
              tool_use_id: toolId,
              type: "tool_result",
              content: `File written: ${memoryFile}`,
            },
          ],
        },
        session_id: sessionId,
      },
      interEventDelay
    )
  } catch {
    await emit(
      {
        type: "user",
        message: {
          content: [
            {
              tool_use_id: toolId,
              type: "tool_result",
              content: "Failed to store",
              is_error: true,
            },
          ],
        },
        session_id: sessionId,
      },
      interEventDelay
    )
  }
}

/**
 * Check if there are any memories stored
 */
function hasMemories(): boolean {
  try {
    const files = fs.readdirSync(cwd).filter((f) => f.startsWith(MEMORY_PREFIX) && f.endsWith(".txt"))
    return files.length > 0
  } catch {
    return false
  }
}

/**
 * Get the newest memory file name (for Bash commands)
 */
function getNewestMemoryFile(): string | null {
  try {
    const files = fs.readdirSync(cwd)
      .filter((f) => f.startsWith(MEMORY_PREFIX) && f.endsWith(".txt"))
      .sort()
      .reverse() // Newest first (timestamps sort naturally)
    if (files.length === 0) return null
    return files[0] // Just the filename, not full path
  } catch {
    return null
  }
}

/**
 * Emit a JSON line to stdout with optional delay
 */
async function emit(obj: unknown, delayMs: number = 0): Promise<void> {
  if (delayMs > 0) {
    await sleep(delayMs)
  }
  console.log(JSON.stringify(obj))
}

/**
 * Main ELIZA processing function
 */
async function runEliza(prompt: string): Promise<void> {
  // Calculate deterministic delays based on input
  const inputHash = hashString(prompt)
  // Base delays, multiplied by ELIZA_DELAY_MULTIPLIER for testing
  const thinkingDelay = (500 + (inputHash % 1000)) * delayMultiplier // 500-1500ms base
  const interEventDelay = (100 + (inputHash % 200)) * delayMultiplier // 100-300ms base

  // Emit session init
  await emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    tools: ["Write", "Read", "Bash", "Edit"],
    model: "eliza-classic-1.0",
  })

  // Simulate "thinking" delay
  await sleep(thinkingDelay)

  // Match pattern and get response
  const { response, fileAction, memoryResponse, isFromFallback } = matchPattern(prompt)

  // If this pattern has a memory response, store it for later (visible Bash tool call)
  if (memoryResponse) {
    await pushMemory(memoryResponse, interEventDelay)
  }

  // Check if we should recall from memory instead of using fallback
  let finalResponse = response

  if (isFromFallback && hasMemories()) {
    // Pop from memory using visible Bash tool calls
    // Step 1: List memory files to find the newest one
    const listToolId = `toolu_${generateId()}`
    await emit(
      {
        type: "assistant",
        message: {
          id: `msg_${generateId()}`,
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: listToolId,
              name: "Bash",
              input: {
                command: `ls -t ${MEMORY_PREFIX}*.txt 2>/dev/null | head -1`,
                description: "Check for stored memories",
              },
            },
          ],
        },
        session_id: sessionId,
      },
      interEventDelay
    )

    // Actually get the newest file (using fs)
    const memoryFilename = getNewestMemoryFile()
    await emit(
      {
        type: "user",
        message: {
          content: [
            {
              tool_use_id: listToolId,
              type: "tool_result",
              content: memoryFilename || "(no memories found)",
            },
          ],
        },
        session_id: sessionId,
      },
      interEventDelay
    )

    if (memoryFilename) {
      const memoryFilePath = path.join(cwd, memoryFilename)

      // Step 2: Read the memory file
      // Step 2: Read the memory file
      const readToolId = `toolu_${generateId()}`
      await emit(
        {
          type: "assistant",
          message: {
            id: `msg_${generateId()}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: readToolId,
                name: "Read",
                input: {
                  file_path: memoryFilePath,
                },
              },
            ],
          },
          session_id: sessionId,
        },
        interEventDelay
      )

      // Actually read the memory (using fs)
      try {
        const memoryContent = fs.readFileSync(memoryFilePath, "utf-8").trim()

        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: readToolId,
                  type: "tool_result",
                  content: memoryContent,
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )

        // Step 3: Delete the memory file (pop from stack)
        const rmToolId = `toolu_${generateId()}`
        await emit(
          {
            type: "assistant",
            message: {
              id: `msg_${generateId()}`,
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: rmToolId,
                  name: "Bash",
                  input: {
                    command: `rm "${memoryFilename}"`,
                    description: "Clear recalled memory",
                  },
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )

        // Actually delete it (using fs)
        fs.unlinkSync(memoryFilePath)

        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: rmToolId,
                  type: "tool_result",
                  content: "Memory cleared",
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )

        // Use the memory content as our response
        finalResponse = memoryContent
      } catch {
        // Memory read failed, fall back to normal response
      }
    }
  }

  // Emit text response
  const msgId = `msg_${generateId()}`
  await emit(
    {
      type: "assistant",
      message: {
        id: msgId,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: finalResponse }],
      },
      session_id: sessionId,
    },
    interEventDelay
  )

  // Execute file action if any
  if (fileAction) {
    const toolId = `toolu_${generateId()}`
    const filePath = path.isAbsolute(fileAction.fileName)
      ? fileAction.fileName
      : path.resolve(cwd, fileAction.fileName)

    if (fileAction.type === "write") {
      // Emit tool_use for Write
      await emit(
        {
          type: "assistant",
          message: {
            id: `msg_${generateId()}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: toolId,
                name: "Write",
                input: {
                  file_path: filePath,
                  content: fileAction.content || "",
                },
              },
            ],
          },
          session_id: sessionId,
        },
        interEventDelay
      )

      // Actually write the file
      await sleep(200) // Simulate I/O delay
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        // Append if file exists (for journal), otherwise create
        if (
          fileAction.fileName.includes("journal") &&
          fs.existsSync(filePath)
        ) {
          fs.appendFileSync(filePath, fileAction.content || "")
        } else {
          fs.writeFileSync(filePath, fileAction.content || "")
        }

        // Emit tool result success
        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: toolId,
                  type: "tool_result",
                  content: `File written successfully: ${filePath}`,
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: toolId,
                  type: "tool_result",
                  content: `Error: ${errorMessage}`,
                  is_error: true,
                },
              ],
            },
            session_id: sessionId,
          },
          100
        )
      }
    } else if (fileAction.type === "read") {
      // Emit tool_use for Read
      await emit(
        {
          type: "assistant",
          message: {
            id: `msg_${generateId()}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: toolId,
                name: "Read",
                input: {
                  file_path: filePath,
                },
              },
            ],
          },
          session_id: sessionId,
        },
        interEventDelay
      )

      // Actually read the file
      await sleep(150) // Simulate I/O delay
      try {
        const content = fs.readFileSync(filePath, "utf-8")
        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: toolId,
                  type: "tool_result",
                  content: content,
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )

        // Follow up with a comment about the file
        await emit(
          {
            type: "assistant",
            message: {
              id: `msg_${generateId()}`,
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "I've read the file. How do you feel about its contents?",
                },
              ],
            },
            session_id: sessionId,
          },
          interEventDelay
        )
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: toolId,
                  type: "tool_result",
                  content: `Error reading file: ${errorMessage}`,
                  is_error: true,
                },
              ],
            },
            session_id: sessionId,
          },
          100
        )
      }
    } else if (fileAction.type === "delete") {
      // Emit tool_use for Bash (rm command)
      await emit(
        {
          type: "assistant",
          message: {
            id: `msg_${generateId()}`,
            type: "message",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: toolId,
                name: "Bash",
                input: {
                  command: `rm -f "${filePath}"`,
                  description: "Delete file as therapeutic exercise",
                },
              },
            ],
          },
          session_id: sessionId,
        },
        interEventDelay
      )

      // Actually delete the file
      await sleep(150) // Simulate I/O delay
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          await emit(
            {
              type: "user",
              message: {
                content: [
                  {
                    tool_use_id: toolId,
                    type: "tool_result",
                    content: `File deleted: ${filePath}`,
                  },
                ],
              },
              session_id: sessionId,
            },
            interEventDelay
          )

          // Therapeutic follow-up
          await emit(
            {
              type: "assistant",
              message: {
                id: `msg_${generateId()}`,
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "The file has been deleted. How does letting go of it make you feel?",
                  },
                ],
              },
              session_id: sessionId,
            },
            interEventDelay
          )
        } else {
          await emit(
            {
              type: "user",
              message: {
                content: [
                  {
                    tool_use_id: toolId,
                    type: "tool_result",
                    content: `File not found: ${filePath}`,
                  },
                ],
              },
              session_id: sessionId,
            },
            interEventDelay
          )
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await emit(
          {
            type: "user",
            message: {
              content: [
                {
                  tool_use_id: toolId,
                  type: "tool_result",
                  content: `Error deleting file: ${errorMessage}`,
                  is_error: true,
                },
              ],
            },
            session_id: sessionId,
          },
          100
        )
      }
    }
  }

  // Emit end result
  await emit(
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: finalResponse,
      session_id: sessionId,
    },
    interEventDelay
  )
}

// Main entry point
const prompt = process.argv.slice(2).join(" ")
if (!prompt) {
  // If no prompt, emit error and exit
  console.log(
    JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "No prompt provided. Usage: eliza <prompt>",
      session_id: sessionId,
    })
  )
  process.exit(1)
}

runEliza(prompt).catch((err) => {
  console.error(JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    result: err instanceof Error ? err.message : String(err),
    session_id: sessionId,
  }))
  process.exit(1)
})
