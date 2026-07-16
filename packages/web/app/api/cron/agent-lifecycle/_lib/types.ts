import { Prisma } from "@prisma/client"

// Prisma payload shapes shared across the agent-lifecycle helpers.

export type ScheduledJobRunWithJob = Prisma.ScheduledJobRunGetPayload<{
  include: { job: true }
}>

export type ChatWithMessages = Prisma.ChatGetPayload<{
  include: {
    messages: {
      where: { role: "assistant" }
      orderBy: { timestamp: "desc" }
      take: 1
    }
  }
}>
