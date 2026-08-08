export type ScheduledJobFormField = "name" | "prompt" | "interval"

export type ScheduledJobFormErrors = Partial<Record<ScheduledJobFormField, string>>

interface ScheduledJobFormValues {
  name: string
  prompt: string
  triggerType: "interval" | "incoming"
  intervalMinutes: number
}

const SCHEDULED_JOB_FIELD_ORDER: ScheduledJobFormField[] = [
  "name",
  "interval",
  "prompt",
]

export function validateScheduledJobForm({
  name,
  prompt,
  triggerType,
  intervalMinutes,
}: ScheduledJobFormValues): ScheduledJobFormErrors {
  const errors: ScheduledJobFormErrors = {}

  if (!name.trim()) {
    errors.name = "Name is required"
  }

  if (triggerType === "interval" && intervalMinutes < 10) {
    errors.interval = "Interval must be at least 10 minutes"
  }

  if (!prompt.trim()) {
    errors.prompt = "Prompt is required"
  }

  return errors
}

export function getFirstInvalidScheduledJobField(
  errors: ScheduledJobFormErrors
): ScheduledJobFormField | null {
  return SCHEDULED_JOB_FIELD_ORDER.find((field) => errors[field]) ?? null
}
