import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getSharedChat } from "@/lib/server/shared-chat"
import { SharedChatView } from "@/components/share/SharedChatView"

// Shared chats are dynamic (live view of the chat's current messages) and
// should not be indexed by search engines.
export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>
}): Promise<Metadata> {
  const { shareId } = await params
  const chat = await getSharedChat(shareId)
  return {
    title: chat?.displayName ? `${chat.displayName} · Shared chat` : "Shared chat",
    robots: { index: false, follow: false },
  }
}

export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const { shareId } = await params
  const chat = await getSharedChat(shareId)
  if (!chat) notFound()

  return <SharedChatView chat={chat} />
}
