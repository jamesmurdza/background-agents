import { prisma } from './lib/prisma.js'

async function main() {
  // Get all messages
  const messages = await prisma.message.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { branch: true }
  })
  
  console.log("=== Recent Messages ===")
  console.log(JSON.stringify(messages, null, 2))
  
  // Get all branches with message counts
  const branches = await prisma.branch.findMany({
    include: {
      _count: { select: { messages: true } }
    }
  })
  
  console.log("\n=== Branches with Message Counts ===")
  for (const b of branches) {
    console.log(`Branch: ${b.name} (${b.id}) - ${b._count.messages} messages`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
