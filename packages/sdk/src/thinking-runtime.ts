import type { RunOptions } from "./core/agent"
import type { CodeAgentSandbox, ProviderName } from "./types/provider"
import { getThinkingCapability, supportsThinking, variantChoice, UnsupportedThinkingError, validateThinking, THINKING_CLI_TIMEOUT_SECONDS, type ThinkingCapability, type ThinkingCapabilityStatus, type ThinkingLevel } from "./thinking"
import { quote } from "./utils/shell"
import { piModelIdentity } from "./agents/pi/model-identity"

const versions: Record<string, readonly number[]> = {
  codex: [0, 159, 3], claude: [2, 1, 197], commandcode: [1, 82, 3],
  copilot: [1, 0, 89], droid: [0, 229, 0], gemini: [0, 61, 0], kimi: [2, 1, 1],
}

export interface ThinkingRuntimeContext {
  cwd?: string
  /** Same effective per-run configuration as launch. Never included in results/logs. */
  env?: Record<string, string>
}

function versionSupported(output: string, minimum: readonly number[]): boolean {
  const actual = output.match(/\b(\d+)\.(\d+)\.(\d+)\b/)?.slice(1).map(Number)
  if (!actual) return false
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i]
  }
  return true
}

function customRoute(agent: string, env: Record<string, string>): boolean {
  return !!(agent === "codex" ? env.CUSTOM_CODEX_BASE_URL || env.OPENAI_BASE_URL
    : agent === "opencode" ? env.CUSTOM_OPENCODE_BASE_URL
    : agent === "claude" ? env.ANTHROPIC_BASE_URL || ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"].some(key => env[key] === "1" || env[key] === "true") ||
      ["ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL"].some(key => !!env[key])
    : agent === "gemini" ? env.GOOGLE_GEMINI_BASE_URL || env.GOOGLE_GENAI_USE_VERTEXAI
    : agent === "kimi" ? env.KIMI_BASE_URL || env.KIMI_CODE_BASE_URL || env.KIMI_MODEL_NAME || env.KIMI_MODEL_PROVIDER
    : false)
}

/** Scope context to this subprocess; never alter the sandbox's shared env/cwd. */
function contextualCommand(command: string, context: ThinkingRuntimeContext): string {
  const exports = Object.entries(context.env ?? {}).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error("Invalid environment name")
    return `export ${key}=${quote(value)}`
  })
  if (context.cwd) exports.push(`cd -- ${quote(context.cwd)} || exit 1`)
  if (!exports.length) return command
  return `( ${exports.join("; ")}; ${command} )`
}

// Read Pi's own registry. Model absence is distinct from an existing empty list.
const piCatalog = `const fs=require('node:fs'),p=require('node:path');
let root=p.dirname(fs.realpathSync(process.argv[1])),file;
while(true){const candidate=p.join(root,'node_modules/@mariozechner/pi-ai/dist/models.js');
if(fs.existsSync(candidate)){file=candidate;break}const parent=p.dirname(root);if(parent===root)break;root=parent;}
if(!file)process.exit(1);
import(require('node:url').pathToFileURL(file).href).then(m=>{
const [provider,...id]=process.argv[2].split('/');const model=m.getModel(provider,id.join('/'));
console.log(JSON.stringify({found:!!model,levels:model?m.getSupportedThinkingLevels(model):[]}));
}).catch(()=>process.exit(1));`

function unavailable(status: ThinkingCapabilityStatus, reason: string): ThinkingCapability {
  return { levels: [], status, reason }
}

function commandFailure(agent: string, exitCode: number): ThinkingCapability {
  return exitCode === 126 || exitCode === 127
    ? unavailable("runtime_unavailable", `${agent} is not available in this sandbox. Start or repair its runtime, then retry; Default remains available.`)
    : unavailable("check_failed", `Could not read ${agent}'s thinking catalog. Retry after the sandbox reconnects, or use Default. This does not mean the model lacks thinking controls.`)
}

/** Observe native capabilities without installing, starting a job, or writing config. */
export async function getRuntimeThinkingCapability(agent: string, model: string, sandbox: CodeAgentSandbox, context: ThinkingRuntimeContext = {}): Promise<ThinkingCapability> {
  const expected = getThinkingCapability(agent, model)
  const execute = (command: string) => sandbox.executeCommandInContext
    ? sandbox.executeCommandInContext(command, THINKING_CLI_TIMEOUT_SECONDS, context)
    : sandbox.executeCommand!(contextualCommand(command, context), THINKING_CLI_TIMEOUT_SECONDS)
  try {
    // A resumed adapter can retain provider routing that is not repeated in
    // this invocation. Inspect the same merge used for execution, but keep the
    // original context for execute() so adapters do not apply it twice.
    const effectiveEnv = sandbox.getEffectiveEnv?.(context.env) ?? context.env ?? {}
    if (customRoute(agent, effectiveEnv)) return unavailable("unverified", "Thinking overrides have not been verified for this custom endpoint. Choose Default.")
    if (!expected.control || !expected.levels.length && !expected.budget) return expected
    if (!sandbox.executeCommand && !sandbox.executeCommandInContext) return unavailable("runtime_unavailable", "Cannot check thinking support in this runtime. Start or reconnect the sandbox, or use Default.")
    if (agent === "opencode" || agent === "kilo") {
      const provider = model.split("/")[0]
      if (!/^[a-z0-9-]+$/.test(provider)) return unavailable("unverified", "Cannot check this provider. Use Default.")
      const result = await execute(`${agent} models ${provider} --verbose`)
      if (result.exitCode !== 0) return commandFailure(agent, result.exitCode)
      const catalog = parseOpenCodeVariants(result.output, model)
      if (catalog.status === "invalid") return unavailable("check_failed", `Could not parse ${agent}'s model catalog. Retry the check or update its CLI; use Default meanwhile.`)
      if (catalog.status === "missing") return unavailable("unverified", `The selected model was not found in ${agent}'s catalog. Check the model/provider configuration or use Default.`)
      if (catalog.status === "unverified") return unavailable("unverified", `The selected model's catalog does not include thinking capability metadata. Retry after updating its runtime; this does not verify that the model lacks controls.`)
      const levels = catalog.variants.map(variantChoice).filter((value): value is ThinkingLevel => value !== undefined)
      if (catalog.variants.length && !levels.length) return unavailable("unverified", "The native catalog lists controls this integration cannot safely represent. Use Default.")
      return {
        ...expected, levels, status: levels.length ? "available" : "no_controls",
        provenance: { source: "native_catalog", evidence: `Installed ${agent} exact model/provider catalog in the selected working directory and configuration; not provider/account acceptance.` },
        reason: levels.length ? undefined : `This sandbox's ${agent} runtime does not advertise adjustable thinking levels for this model. Default keeps its native behavior.`,
      }
    }
    if (agent === "pi") {
      const identity = piModelIdentity(model)
      if (!identity) return unavailable("unverified", "Cannot identify this exact Pi model/provider. Choose Default.")
      const result = await execute(`node -e ${quote(piCatalog)} "$(command -v pi)" ${quote(identity)}`)
      if (result.exitCode !== 0) return commandFailure(agent, result.exitCode)
      const value: unknown = JSON.parse(result.output.trim())
      // Accept the legacy array wire shape for custom sandbox adapters.
      const record = isRecord(value) ? value : undefined
      if (record?.found === false) return unavailable("unverified", "Pi's registry does not contain this exact model. Check the model/provider or use Default.")
      const values = Array.isArray(value) ? value : record?.found === true && Array.isArray(record.levels) ? record.levels : undefined
      if (!values) return unavailable("check_failed", "Could not parse Pi's model registry. Retry the check or use Default.")
      const levels = values.filter((v): v is ThinkingLevel => typeof v === "string" && v !== "default" && supportsThinking(expected, v))
      if (values.length && !levels.length) return values.some(v => typeof v !== "string")
        ? unavailable("check_failed", "Could not parse Pi's thinking controls. Retry the check or use Default.")
        : unavailable("unverified", "Pi's registry lists controls this integration cannot safely represent. Use Default.")
      return { ...expected, levels, status: levels.length ? "available" : "no_controls", provenance: { source: "native_catalog", evidence: "Installed Pi exact-model registry; not provider/account acceptance." }, reason: levels.length ? undefined : "Pi does not advertise adjustable thinking controls for this exact model. Use Default." }
    }
    const minimum = versions[agent]
    if (!minimum) return unavailable("unverified", "No runtime check is available for this agent. Use Default.")
    const path = agent === "droid" ? 'PATH="$HOME/.local/bin:$PATH" ' : agent === "kimi" ? 'PATH="$HOME/.kimi-code/bin:$PATH" ' : ""
    const result = await sandbox.readProviderVersion?.(agent as ProviderName, THINKING_CLI_TIMEOUT_SECONDS, context)
      ?? await execute(`${path}${agent} --version`)
    if (result.exitCode !== 0) return commandFailure(agent, result.exitCode)
    const runtimeVersion = result.output.match(/\b\d+\.\d+\.\d+\b/)?.[0]
    if (!runtimeVersion) return unavailable("check_failed", `Could not identify the ${agent} runtime version. Retry the check or use Default.`)
    if (!versionSupported(result.output, minimum)) return { ...unavailable("unverified", `This ${agent} runtime has not been verified for thinking overrides. Update to ${minimum.join(".")} or later, or choose Default.`), runtimeVersion }
    return { ...expected, status: "available", runtimeVersion, provenance: { source: "runtime_version", runtimeVersion, evidence: "Installed CLI meets the SDK minimum version; choices come from the SDK model contract, not a live model/account acceptance check." } }
  } catch {
    // Transport/config/parser errors are surfaced as a distinct failure state;
    // command output and context can contain secrets and must not be logged.
    return unavailable("check_failed", "Could not check this runtime's thinking levels. Use Default and try again after the sandbox reconnects.")
  }
}

/** Default means no SDK override, not a reset of user config or native history. */
export async function verifyThinkingRuntime(agent: string, options: RunOptions, sandbox: CodeAgentSandbox): Promise<void> {
  const level = validateThinking(agent, options.model, options.thinking)
  if (level === "default") return
  const capability = await getRuntimeThinkingCapability(agent, options.model!, sandbox, { cwd: options.cwd, env: options.env })
  if (capability.status === "available" && supportsThinking(capability, level)) return
  if (capability.status !== "available") throw new UnsupportedThinkingError(capability.reason ?? "Could not verify this thinking setting. Choose Default or retry the check.")
  throw new UnsupportedThinkingError(`The installed ${agent === "opencode" ? "OpenCode" : agent} runtime does not advertise this thinking setting for the selected model. Choose Default or a supported level.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Native models --verbose emits an ID followed by a pretty-printed object. */
function parseOpenCodeVariants(output: string, model: string): { status: "found"; variants: string[] } | { status: "invalid" | "missing" | "unverified"; variants: [] } {
  let validEntries = 0
  for (const match of output.matchAll(/(?:^|\n)([^\n]+)\n(\{[\s\S]*?\n\})(?=\n|$)/g)) {
    let entry: unknown
    try { entry = JSON.parse(match[2]) } catch {
      if (match[1].trim() === model) return { status: "invalid", variants: [] }
      continue
    }
    if (!isRecord(entry)) continue
    validEntries++
    if (match[1].trim() !== model) continue
    if (entry.variants === undefined) return { status: "unverified", variants: [] }
    if (!isRecord(entry.variants)) return { status: "invalid", variants: [] }
    const variants: string[] = []
    let malformedVariant = false
    for (const [name, value] of Object.entries(entry.variants)) {
      if (!isRecord(value)) {
        malformedVariant = true
        continue // A malformed sibling must not hide valid enabled variants.
      }
      if (value.disabled !== true) variants.push(name)
    }
    if (!variants.length && malformedVariant) return { status: "invalid", variants: [] }
    return { status: "found", variants }
  }
  const selectedLinePresent = output.split("\n").some(line => line.trim() === model)
  return { status: validEntries && !selectedLinePresent ? "missing" : "invalid", variants: [] }
}

/** Compatibility helper: callers needing diagnostic status use discovery above. */
export function readOpenCodeVariants(output: string, model: string): string[] {
  return parseOpenCodeVariants(output, model).variants
}
