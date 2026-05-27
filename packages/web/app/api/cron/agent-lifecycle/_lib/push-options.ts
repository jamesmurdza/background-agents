import { prisma } from "@/lib/db/prisma"
import type { Settings } from "@/lib/types"
import { DEFAULT_SETTINGS } from "@/lib/storage"

/**
 * Resolve git push options for a user from their saved settings. Currently this
 * just maps the `enablePrepushHooks` setting to git's `--no-verify` flag.
 */
export async function getUserPushOptions(userId: string): Promise<{ noVerify: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  })
  if (user?.settings) {
    const s = user.settings as Partial<Settings>
    const enablePrepushHooks = s.enablePrepushHooks ?? DEFAULT_SETTINGS.enablePrepushHooks
    return { noVerify: !enablePrepushHooks }
  }
  return { noVerify: !DEFAULT_SETTINGS.enablePrepushHooks }
}
