import type { QueuedMessage } from "./types"

const PREFIX = "simple-chat-queue:"
type RecordValue = { item: QueuedMessage | null; order: number }
type QueueMap = Record<string, QueuedMessage[] | undefined>
const keyFor = (chatId: string, id: string) => `${PREFIX}${encodeURIComponent(chatId)}:${encodeURIComponent(id)}`

function records(): Array<{ key: string; chatId: string; id: string; value: RecordValue }> {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return []
  const result = []
  try { for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key?.startsWith(PREFIX)) continue
    try {
      const [chatId, id] = key.slice(PREFIX.length).split(":").map(decodeURIComponent)
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as RecordValue | null
      if (chatId && id && value && typeof value.order === "number" &&
          (value.item === null || value.item?.id === id)) result.push({ key, chatId, id, value })
    } catch { /* Leave an unreadable entry alone; never erase another tab's data. */ }
  } } catch { /* Blocked device storage must not prevent the app from loading. */ }
  return result
}

/** Separate keys make writes to different prompt IDs independent across tabs. */
export function readQueueOutbox(legacy: QueueMap): QueueMap {
  const queues = new Map<string, Map<string, RecordValue>>()
  for (const [chatId, items] of Object.entries(legacy)) {
    queues.set(chatId, new Map(items?.map((item, order) => [item.id, { item, order }]) ?? []))
  }
  for (const record of records()) {
    const items = queues.get(record.chatId) ?? new Map<string, RecordValue>()
    if (record.value.item) items.set(record.id, record.value)
    else items.delete(record.id)
    queues.set(record.chatId, items)
  }
  return Object.fromEntries([...queues].map(([chatId, items]) => [chatId,
    [...items.values()].sort((a, b) => a.order - b.order || a.item!.id.localeCompare(b.item!.id)).map((entry) => entry.item!),
  ]))
}

/** Apply only this caller's changes; never replace another tab's queue array. */
export function patchQueueOutbox(chatId: string, previous: QueuedMessage[], next: QueuedMessage[], legacy: QueuedMessage[]) {
  if (typeof window === "undefined") return
  const before = new Map(previous.map((item) => [item.id, item]))
  const after = new Map(next.map((item) => [item.id, item]))
  const currentRecords = records().filter((record) => record.chatId === chatId)
  const current = new Map(currentRecords.map((record) => [record.id, record.value]))
  let order = Math.max(Date.now(), ...currentRecords.map((record) => record.value.order + 1))
  for (const item of next) {
    if (JSON.stringify(before.get(item.id)) === JSON.stringify(item)) continue
    const stored = current.get(item.id)
    const legacyIndex = legacy.findIndex((entry) => entry.id === item.id)
    // Another tab already acknowledged/deleted this ID. A stale metadata update
    // must not recreate it. New sends always have a fresh client request ID.
    if (stored?.item === null || (before.has(item.id) && !stored && legacyIndex < 0)) continue
    const updated = {
      ...item,
      // A late POST result cannot undo a removal requested in another tab.
      ...(stored?.item?.cancelRequested && !item.cancelFailed ? { cancelRequested: true } : {}),
    }
    localStorage.setItem(keyFor(chatId, item.id), JSON.stringify({
      item: updated, order: stored?.order ?? (legacyIndex >= 0 ? legacyIndex : order++),
    } satisfies RecordValue))
  }
  for (const id of before.keys()) {
    if (after.has(id)) continue
    if (legacy.some((item) => item.id === id)) {
      // Only legacy entries need a tombstone: the old shared array remains
      // read-only, so a stale tab cannot re-import an acknowledged legacy item.
      localStorage.setItem(keyFor(chatId, id), JSON.stringify({ item: null, order: 0 } satisfies RecordValue))
    } else {
      localStorage.removeItem(keyFor(chatId, id))
    }
  }
}

export function clearQueueOutbox(chatIds?: string[]) {
  for (const record of records()) if (!chatIds || chatIds.includes(record.chatId)) localStorage.removeItem(record.key)
}

export function migrateQueueOutbox(fromId: string, toId: string) {
  for (const record of records()) {
    if (record.chatId !== fromId) continue
    const target = keyFor(toId, record.id)
    if (!localStorage.getItem(target)) localStorage.setItem(target, JSON.stringify(record.value))
    localStorage.removeItem(record.key)
  }
}
