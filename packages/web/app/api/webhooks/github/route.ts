import { createHmac, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/db/prisma"

// =============================================================================
// Types
// =============================================================================

interface WorkflowRunPayload {
  action: string // "completed" | "requested" | etc.
  workflow_run: {
    id: number
    name: string
    conclusion: string | null // "success" | "failure" | "cancelled" | null
    head_branch: string
    head_sha: string
    html_url: string
    workflow_id: number
  }
  repository: {
    full_name: string
    owner: { login: string }
    name: string
  }
}

// =============================================================================
// Webhook Signature Verification
// =============================================================================

function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = createHmac("sha256", secret)
  hmac.update(payload)
  const expected = `sha256=${hmac.digest("hex")}`

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// =============================================================================
// POST - Receive GitHub webhook events
// =============================================================================

export async function POST(req: Request): Promise<Response> {
  // 1. Get headers
  const signature = req.headers.get("x-hub-signature-256")
  const event = req.headers.get("x-github-event")
  const deliveryId = req.headers.get("x-github-delivery")

  // Only process workflow_run events
  if (event !== "workflow_run") {
    return new Response("Event ignored", { status: 200 })
  }

  if (!signature) {
    return new Response("Missing signature", { status: 400 })
  }

  // 2. Parse body
  const rawBody = await req.text()
  let payload: WorkflowRunPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  // 3. Only process completed workflow runs that failed
  if (
    payload.action !== "completed" ||
    payload.workflow_run.conclusion !== "failure"
  ) {
    return new Response("Event ignored - not a failure", { status: 200 })
  }

  const repo = payload.repository.full_name

  // 4. Find all webhook-triggered jobs for this repo
  const jobs = await prisma.scheduledJob.findMany({
    where: {
      repo,
      triggerType: "webhook",
      enabled: true,
      webhookSecret: { not: null },
    },
  })

  if (jobs.length === 0) {
    return new Response("No matching jobs", { status: 200 })
  }

  // 5. Verify signature against each job's secret and trigger matching ones
  const triggeredJobs: string[] = []

  for (const job of jobs) {
    if (!job.webhookSecret) continue

    // Verify signature
    if (!verifySignature(rawBody, signature, job.webhookSecret)) {
      continue
    }

    // Check if job already has a pending/running run
    const existingRun = await prisma.scheduledJobRun.findFirst({
      where: {
        jobId: job.id,
        status: { in: ["pending", "running"] },
      },
    })

    if (existingRun) {
      continue // Skip - already has an active run
    }

    // Create a new pending run with trigger context
    await prisma.scheduledJobRun.create({
      data: {
        jobId: job.id,
        status: "pending",
        triggerContext: {
          workflowName: payload.workflow_run.name,
          workflowUrl: payload.workflow_run.html_url,
          branch: payload.workflow_run.head_branch,
          commitSha: payload.workflow_run.head_sha,
          failedAt: new Date().toISOString(),
        },
      },
    })

    triggeredJobs.push(job.id)
  }

  return Response.json({
    triggered: triggeredJobs.length,
    deliveryId,
    repo,
    workflow: payload.workflow_run.name,
    branch: payload.workflow_run.head_branch,
  })
}
