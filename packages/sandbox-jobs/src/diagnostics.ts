const SECRET_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY|AUTHORIZATION|PRIVATE_KEY)/i

/** Bootstrap output can echo arguments or credentials. Keep only the diagnostic
 * text, scrub known secret values, and bound it before passing it to callers. */
export function sandboxDiagnostic(output: string, env: Record<string, string> = {}): string {
  const secrets = [
    ...Object.entries(process.env).filter(([key]) => SECRET_ENV_NAME.test(key)).map(([, value]) => value),
    ...Object.values(env),
  ].filter((value): value is string => !!value)

  let message = output
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
  // A transport error can quote the entire request, including multiline shell
  // source and embedded command arguments. Discard echoed launch scripts.
  if (/launch\.lock.*flock|SBJ-ABORTED/i.test(message)) return ""
  for (const secret of secrets.sort((a, b) => b.length - a.length)) {
    const quoted = JSON.stringify(secret).slice(1, -1)
    message = message.replaceAll(quoted, "[REDACTED]").replaceAll(secret, "[REDACTED]")
  }
  return message
    // Shell traces and errors that echo the generated launcher can contain the
    // prompt or embedded command arguments, even after env values are scrubbed.
    .split("\n")
    .filter((line) => !/^\s*\+|["']envs?["']\s*:|setsid sh -c/i.test(line))
    .join("\n")
    .replace(/\b(Bearer|Basic)[ \t]+[\w.+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(\b(?:https?:\/\/))[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?[ \t]*[:=][ \t]*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/gi, "$1[REDACTED]")
    .trim()
    .slice(0, 2_000)
}
