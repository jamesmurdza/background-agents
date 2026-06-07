"use strict";

// Tiny dependency-free terminal UI: colors + a spinner. Keeping this free of
// npm deps means `npx background-agents` installs fast (only Electron is heavy).

const useColor =
  process.env.NO_COLOR == null &&
  process.env.TERM !== "dumb" &&
  (Boolean(process.stdout.isTTY) || process.env.FORCE_COLOR != null);

function wrap(open, close) {
  return (s) => (useColor ? `[${open}m${s}[${close}m` : String(s));
}

const colors = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

const symbols = {
  success: colors.green("✔"),
  error: colors.red("✖"),
  warn: colors.yellow("⚠"),
  info: colors.cyan("ℹ"),
  arrow: colors.gray("›"),
  bullet: colors.gray("•"),
};

const isTTY = Boolean(process.stdout.isTTY);

const HIDE_CURSOR = "[?25l";
const SHOW_CURSOR = "[?25h";
const CLEAR_LINE = "\r[2K";

function showCursor() {
  if (isTTY) process.stdout.write(SHOW_CURSOR);
}

class Spinner {
  constructor() {
    this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.index = 0;
    this.timer = null;
    this.text = "";
  }

  start(text) {
    this.text = text;
    if (!isTTY) {
      process.stdout.write(`  ${text}\n`);
      return this;
    }
    if (this.timer) return this;
    process.stdout.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => this.render(), 80);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  render() {
    const frame = colors.cyan(this.frames[this.index]);
    this.index = (this.index + 1) % this.frames.length;
    process.stdout.write(`${CLEAR_LINE}  ${frame} ${this.text}`);
  }

  update(text) {
    this.text = text;
    if (!isTTY) process.stdout.write(`  ${text}\n`);
    return this;
  }

  stop(symbol, text) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const message = text != null ? text : this.text;
    const line = `  ${symbol} ${message}`;
    if (isTTY) process.stdout.write(`${CLEAR_LINE}${line}\n${SHOW_CURSOR}`);
    else process.stdout.write(`${line}\n`);
    return this;
  }

  succeed(text) {
    return this.stop(symbols.success, text);
  }
  fail(text) {
    return this.stop(symbols.error, text);
  }
  warn(text) {
    return this.stop(symbols.warn, text);
  }
  info(text) {
    return this.stop(symbols.info, text);
  }
}

function line(text = "") {
  process.stdout.write(`${text}\n`);
}

module.exports = { colors, symbols, Spinner, line, isTTY, showCursor };
