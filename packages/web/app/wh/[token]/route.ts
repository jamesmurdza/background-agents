import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

// =============================================================================
// POST - Generic incoming webhook receiver
// =============================================================================
//
// Fires the scheduled job identified by <token>. The token in the URL path is
// the entire auth — no signature header, no shared secret beyond the URL
// itself. This is the same model Slack incoming webhooks, Discord webhooks,
// Stripe webhook endpoints, and Zapier hooks use.
//
// Accepts any JSON body. The whole payload is stashed on the run as
// triggerContext and the runner renders it into the agent's prompt.

const MAX_PAYLOAD_BYTES = 1_000_000 // 1 MB — plenty for any sane webhook payload

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params

  if (!token || token.length < 16) {
    return new Response("Invalid token", { status: 404 })
  }

  // Cap body size before parsing to avoid memory blow-ups from a misconfigured
  // sender. Content-Length isn't trustworthy on its own but lets us short-
  // circuit obvious cases.
  const contentLength = req.headers.get("content-length")
  if (contentLength && Number(contentLength) > MAX_PAYLOAD_BYTES) {
    return new Response("Payload too large", { status: 413 })
  }

  const rawBody = await req.text()
  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return new Response("Payload too large", { status: 413 })
  }

  // Look up the job. A 404 on a wrong token leaks nothing — tokens are random
  // UUIDs and the response is identical to "no such job".
  const job = await prisma.scheduledJob.findUnique({
    where: { incomingToken: token },
    select: {
      id: true,
      enabled: true,
      triggerType: true,
      isDraft: true,
    },
  })

  if (!job || job.triggerType !== "incoming" || job.isDraft) {
    return new Response("Not found", { status: 404 })
  }

  if (!job.enabled) {
    // Distinct from 404 so the user can tell their integration is wired up
    // but their job is paused.
    return new Response("Job disabled", { status: 409 })
  }

  // Dedupe: if a run is already in flight for this job, drop the new event.
  // Same behavior as the GitHub webhook path.
  const existingRun = await prisma.scheduledJobRun.findFirst({
    where: {
      jobId: job.id,
      status: { in: ["pending", "running"] },
    },
    select: { id: true },
  })

  if (existingRun) {
    return Response.json(
      { status: "skipped", reason: "run already in progress" },
      { status: 202 }
    )
  }

  // Parse the payload. We accept non-JSON bodies (some senders POST form data
  // or plain text) — fall back to wrapping the raw body so the runner still
  // has something useful to show the agent.
  let payload: unknown
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {}
  } catch {
    payload = { raw: rawBody }
  }

  // Capture a few request headers the agent might want (event type, source).
  // Whitelist rather than dumping everything — Cookie/Authorization would
  // leak the sender's session.
  const headers: Record<string, string> = {}
  const headerAllowList = [
    "x-github-event",
    "x-gitlab-event",
    "x-event-key", // Bitbucket
    "x-slack-trigger-id",
    "user-agent",
  ]
  for (const name of headerAllowList) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }

  const run = await prisma.scheduledJobRun.create({
    data: {
      jobId: job.id,
      status: "pending",
      triggerContext: {
        source: "incoming",
        receivedAt: new Date().toISOString(),
        headers,
        // `payload` is unknown because we accept arbitrary JSON. Prisma's
        // Json input type doesn't accept unknown, so we widen here — the
        // value will round-trip through PG as JSONB regardless of shape.
        payload: payload as Prisma.InputJsonValue,
      },
    },
    select: { id: true },
  })

  return Response.json(
    { status: "queued", runId: run.id },
    { status: 202 }
  )
}
