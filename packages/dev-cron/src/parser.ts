/**
 * Parse a cron expression and return the interval in milliseconds.
 *
 * Supports common patterns:
 *   * * * * *       → every minute (60,000ms)
 *   *\/2 * * * *    → every 2 minutes (120,000ms)
 *   *\/5 * * * *    → every 5 minutes (300,000ms)
 *   0 * * * *       → every hour (3,600,000ms)
 *   0 *\/2 * * *    → every 2 hours (7,200,000ms)
 *
 * Note: This is a simplified parser for dev purposes.
 * Complex expressions (day-of-week, specific times) default to 1 minute.
 */
export function cronToMs(schedule: string): number {
  const parts = schedule.trim().split(/\s+/)

  if (parts.length !== 5) {
    console.warn(`Invalid cron expression "${schedule}", defaulting to 1 minute`)
    return 60_000
  }

  const [minute, hour] = parts

  // Every N minutes: */N * * * *
  if (minute.startsWith("*/")) {
    const n = parseInt(minute.slice(2), 10)
    if (!isNaN(n) && n > 0) {
      return n * 60_000
    }
  }

  // Every minute: * * * * *
  if (minute === "*") {
    // Check if hour has interval: * */N * * *
    if (hour.startsWith("*/")) {
      const n = parseInt(hour.slice(2), 10)
      if (!isNaN(n) && n > 0) {
        return n * 60 * 60_000
      }
    }
    return 60_000
  }

  // Every hour at minute 0: 0 * * * *
  if (minute === "0" && hour === "*") {
    return 60 * 60_000
  }

  // Every N hours at minute 0: 0 */N * * *
  if (minute === "0" && hour.startsWith("*/")) {
    const n = parseInt(hour.slice(2), 10)
    if (!isNaN(n) && n > 0) {
      return n * 60 * 60_000
    }
  }

  // Default: treat as every minute for dev purposes
  console.warn(`Complex cron expression "${schedule}", defaulting to 1 minute for dev`)
  return 60_000
}

/**
 * Format milliseconds as a human-readable string
 */
export function formatInterval(ms: number): string {
  if (ms < 60_000) {
    return `${ms / 1000}s`
  }
  if (ms < 60 * 60_000) {
    return `${ms / 60_000}m`
  }
  return `${ms / (60 * 60_000)}h`
}
