import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { encrypt, decrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
} from "@/lib/api-helpers"

// GET - Retrieve env var keys (not values) for a repo
export async function GET(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params

  // Find repo and verify ownership
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { userId: true, envVars: true },
  })

  if (!repo) {
    return notFound("Repository not found")
  }

  if (repo.userId !== userId) {
    return notFound("Repository not found")
  }

  // Return only the keys, not the values (for security)
  const envVars = repo.envVars as Record<string, string> | null
  const envVarKeys: Record<string, boolean> = {}

  if (envVars) {
    for (const key of Object.keys(envVars)) {
      envVarKeys[key] = true
    }
  }

  return Response.json({ envVars: envVarKeys })
}

// POST - Save env vars for a repo
export async function POST(
  req: Request,
  { params }: { params: Promise<{ repoId: string }> }
) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const { repoId } = await params

  // Find repo and verify ownership
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: { userId: true, envVars: true },
  })

  if (!repo) {
    return notFound("Repository not found")
  }

  if (repo.userId !== userId) {
    return notFound("Repository not found")
  }

  const body = await req.json()
  const { envVars } = body as { envVars: Record<string, string | null> }

  if (!envVars || typeof envVars !== "object") {
    return badRequest("Invalid envVars format")
  }

  // Validate env var keys
  for (const key of Object.keys(envVars)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return badRequest(`Invalid environment variable key: ${key}`)
    }
  }

  // Get existing env vars and decrypt them
  const existingEnvVars = repo.envVars as Record<string, string> | null
  const decryptedEnvVars: Record<string, string> = {}

  if (existingEnvVars) {
    for (const [key, encryptedValue] of Object.entries(existingEnvVars)) {
      try {
        decryptedEnvVars[key] = decrypt(encryptedValue)
      } catch {
        // If decryption fails, skip this key
      }
    }
  }

  // Apply updates
  for (const [key, value] of Object.entries(envVars)) {
    if (value === null) {
      // Delete this key
      delete decryptedEnvVars[key]
    } else if (typeof value === "string" && value.trim()) {
      // Set/update this key
      decryptedEnvVars[key] = value.trim()
    }
  }

  // Encrypt all values for storage
  const encryptedEnvVars: Record<string, string> = {}
  for (const [key, value] of Object.entries(decryptedEnvVars)) {
    encryptedEnvVars[key] = encrypt(value)
  }

  // Save to database
  await prisma.repo.update({
    where: { id: repoId },
    data: {
      envVars: Object.keys(encryptedEnvVars).length > 0 ? encryptedEnvVars : Prisma.JsonNull,
    },
  })

  return Response.json({ success: true })
}
