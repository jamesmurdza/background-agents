import { NextRequest } from "next/server"
import { badRequest } from "@/lib/db/api-helpers"
import type { MessagePayload } from "./types"

export interface ParsedMessageRequest {
  payload: MessagePayload
  files: File[]
}

/**
 * Parse the POST body (multipart/form-data with `payload` + `file-*` parts, or
 * application/json) and validate the required fields. Returns the parsed payload
 * and any attached files, or a `Response` (400) describing the validation error.
 */
export async function parseMessageRequest(
  req: NextRequest
): Promise<ParsedMessageRequest | Response> {
  let payload: MessagePayload
  const files: File[] = []
  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData()
    const payloadJson = formData.get("payload")
    if (typeof payloadJson !== "string") return badRequest("Missing payload")
    try {
      payload = JSON.parse(payloadJson) as MessagePayload
    } catch {
      return badRequest("Invalid payload JSON")
    }
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("file-") && value instanceof File) files.push(value)
    }
  } else {
    payload = (await req.json()) as MessagePayload
  }

  if (
    !payload.message ||
    !payload.agent ||
    !payload.model ||
    !payload.userMessageId ||
    !payload.assistantMessageId
  ) {
    return badRequest("Missing required fields")
  }

  return { payload, files }
}
