/**
 * Prisma Include Patterns
 *
 * Centralizes common Prisma include patterns used across API routes.
 * This reduces duplication and ensures consistent data loading patterns.
 *
 * Pattern naming convention:
 * - INCLUDE_* = full include object for prisma queries
 * - SELECT_* = select-only patterns for specific fields
 */

import { Prisma } from "@prisma/client"
import { PAGINATION } from "@/lib/constants"

// =============================================================================
// Branch Includes
// =============================================================================

/**
 * Branch include with sandbox and messages - for branch detail views
 */
export const INCLUDE_BRANCH_WITH_MESSAGES = {
  sandbox: true,
  messages: {
    orderBy: { createdAt: "asc" },
    take: PAGINATION.MESSAGES_PER_REQUEST,
  },
} satisfies Prisma.BranchInclude

/**
 * Branch include for list views - no messages, just counts
 */
export const INCLUDE_BRANCH_FOR_LIST = {
  sandbox: true,
  messages: false,
  _count: {
    select: { messages: true },
  },
} satisfies Prisma.BranchInclude

/**
 * Branch include with repo - for ownership checks
 */
export const INCLUDE_BRANCH_WITH_REPO = {
  repo: true,
} satisfies Prisma.BranchInclude

/**
 * Branch include with repo and sandbox - for branch operations
 */
export const INCLUDE_BRANCH_WITH_REPO_AND_SANDBOX = {
  repo: true,
  sandbox: true,
} satisfies Prisma.BranchInclude

// =============================================================================
// Repo Includes
// =============================================================================

/**
 * Repo include with branches for list views (no messages)
 */
export const INCLUDE_REPO_FOR_LIST = {
  branches: {
    include: INCLUDE_BRANCH_FOR_LIST,
    orderBy: { updatedAt: "desc" },
    take: PAGINATION.BRANCHES_PER_REPO,
  },
  _count: {
    select: { branches: true },
  },
} satisfies Prisma.RepoInclude

/**
 * Repo include with basic branches
 */
export const INCLUDE_REPO_WITH_BRANCHES = {
  branches: true,
} satisfies Prisma.RepoInclude

// =============================================================================
// Sandbox Includes
// =============================================================================

/**
 * Sandbox include with user credentials - for agent execution
 */
export const INCLUDE_SANDBOX_WITH_USER_CREDENTIALS = {
  user: { include: { credentials: true } },
  branch: { include: { repo: true } },
} satisfies Prisma.SandboxInclude

// =============================================================================
// Message Includes
// =============================================================================

/**
 * Message include with branch and repo - for ownership checks
 */
export const INCLUDE_MESSAGE_WITH_BRANCH = {
  branch: { include: { repo: true } },
} satisfies Prisma.MessageInclude

// =============================================================================
// Agent Execution Includes
// =============================================================================

/**
 * Agent execution include with full context - for status polling
 */
export const INCLUDE_EXECUTION_WITH_CONTEXT = {
  message: {
    include: {
      branch: {
        include: {
          sandbox: {
            include: {
              user: {
                include: {
                  credentials: true,
                },
              },
            },
          },
          repo: true,
        },
      },
    },
  },
} satisfies Prisma.AgentExecutionInclude

// =============================================================================
// Type Exports (for TypeScript inference)
// =============================================================================

// These types can be used to infer the return type of Prisma queries
// using the include patterns above

export type BranchWithMessages = Prisma.BranchGetPayload<{
  include: typeof INCLUDE_BRANCH_WITH_MESSAGES
}>

export type BranchForList = Prisma.BranchGetPayload<{
  include: typeof INCLUDE_BRANCH_FOR_LIST
}>

export type BranchWithRepo = Prisma.BranchGetPayload<{
  include: typeof INCLUDE_BRANCH_WITH_REPO
}>

export type BranchWithRepoAndSandbox = Prisma.BranchGetPayload<{
  include: typeof INCLUDE_BRANCH_WITH_REPO_AND_SANDBOX
}>

export type RepoForList = Prisma.RepoGetPayload<{
  include: typeof INCLUDE_REPO_FOR_LIST
}>

export type RepoWithBranches = Prisma.RepoGetPayload<{
  include: typeof INCLUDE_REPO_WITH_BRANCHES
}>

export type SandboxWithUserCredentials = Prisma.SandboxGetPayload<{
  include: typeof INCLUDE_SANDBOX_WITH_USER_CREDENTIALS
}>

export type MessageWithBranch = Prisma.MessageGetPayload<{
  include: typeof INCLUDE_MESSAGE_WITH_BRANCH
}>

export type ExecutionWithContext = Prisma.AgentExecutionGetPayload<{
  include: typeof INCLUDE_EXECUTION_WITH_CONTEXT
}>
