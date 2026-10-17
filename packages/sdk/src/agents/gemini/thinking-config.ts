import type { CommandSpec } from "../../core/agent"
import type { ThinkingLevel } from "../../thinking"

/** Per-invocation user overlay; never edit shared Gemini settings or auth. */
export function withGeminiThinking(spec: CommandSpec, model: string, level: ThinkingLevel): CommandSpec {
  if (level === "default") return spec
  const thinking = level.startsWith("budget:") ? { thinkingBudget: Number(level.slice(7)) }
    : level === "off" ? { thinkingBudget: 0 } : { thinkingLevel: level.toUpperCase() }
  return {
    cmd: "node", env: spec.env,
    args: ["-e", launcher, JSON.stringify({ model, thinking, args: spec.args })],
  }
}

// Executed inside the sandbox. Settings with JSON comments/custom generation
// rules need explicit reconciliation, not a best-effort rewrite. Fail closed
// while preserving the ordinary Model default path unchanged.
const launcher = String.raw`
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const input = JSON.parse(process.argv[1]);
let directory;
function cleanup() {
  if (!directory) return;
  // Only our fresh temporary tree. Symlinks are unlinked, never traversed.
  try { fs.rmSync(directory, { recursive: true }); } catch {}
}
try {
  const system = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH || '/etc/gemini-cli/settings.json';
  const defaults = process.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH || path.join(path.dirname(system), 'system-defaults.json');
  const original = path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini');
  const read = file => {
    try {
      if (fs.statSync(file).size > 1024 * 1024) throw new Error('Settings too large');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
      return value;
    } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const base = read(path.join(original, 'settings.json'));
  const paths = [defaults, system];
  let current = process.cwd();
  while (true) {
    paths.push(path.join(current, '.gemini', 'settings.json'));
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  if ([base, ...paths.map(read)].some(settings => settings.modelConfigs)) {
    throw new Error('Custom generation settings require reconciliation');
  }
  const match = { model: input.model, overrideScope: 'core' };
  base.modelConfigs = { customOverrides: [
    { match, modelConfig: { generateContentConfig: { thinkingConfig: null } } },
    { match, modelConfig: { generateContentConfig: { thinkingConfig: input.thinking } } }
  ] };
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backgrounder-gemini-thinking-'));
  fs.chmodSync(directory, 0o700);
  const config = path.join(directory, '.gemini');
  fs.mkdirSync(config, { mode: 0o700 });
  // Preserve native session storage and auth at their original paths. Only
  // settings are private to this invocation, including concurrent low/high runs.
  fs.mkdirSync(path.join(original, 'tmp'), { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(original)) {
    if (name !== 'settings.json') fs.symlinkSync(path.join(original, name), path.join(config, name));
  }
  const file = path.join(config, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(base), { mode: 0o600, flag: 'wx' });
  const child = spawn('gemini', input.args, { stdio: 'inherit', env: {
    ...process.env, GEMINI_CLI_HOME: directory
  } });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { cleanup(); console.error('Could not start Gemini. Retry with Default.'); process.exitCode = 1; });
  child.on('close', (code, signal) => { cleanup(); process.exitCode = code ?? (signal ? 130 : 1); });
  process.on('exit', cleanup);
} catch {
  cleanup();
  console.error('Cannot safely apply Gemini thinking with the existing settings. Choose Default or review the Gemini configuration.');
  process.exitCode = 1;
}
`
