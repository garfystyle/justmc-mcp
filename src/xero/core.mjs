import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { VENDOR, WORKSPACE } from "../paths.mjs";

const require = createRequire(import.meta.url);
const core = require(join(VENDOR, "xero.cjs"));

const call = (name, ...args) => {
  const parsed = JSON.parse(core[name](...args));
  if (parsed && !Array.isArray(parsed) && typeof parsed.error === "string" && !("text" in parsed) && !("edits" in parsed)) {
    throw new Error(parsed.error);
  }
  return parsed;
};

const MODULE_PREFIX = "module:";
const CONNECT_PREFIX = "module:connect:";

export function position(text, offset) {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = text.indexOf("\n"); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, column: end - last };
}

const lineText = (text, line) => text.split("\n")[line - 1]?.replace(/\r$/, "") ?? "";

function describe(diagnostic, texts, main) {
  const file = diagnostic.file ?? main;
  const text = texts.get(file) ?? "";
  const at = position(text, diagnostic.start ?? 0);
  const out = {
    severity: diagnostic.severity,
    message: diagnostic.message,
    file,
    line: at.line,
    column: at.column,
    code: lineText(text, at.line).trim(),
  };
  if (diagnostic.hint) out.hint = diagnostic.hint;
  if (diagnostic.fixes?.length) {
    out.fixes = diagnostic.fixes.map((f) => ({ title: f.title, start: f.start, end: f.end, replace: text.slice(f.start, f.end), with: f.text }));
  }
  return out;
}

const DEBUG_FILE = /\.debug\.xero$/;

function sources(dir, debug) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".xero") && (debug || !DEBUG_FILE.test(entry.name))) found.push(path);
    }
  };
  walk(dir);
  const sorted = found.sort();
  return [...sorted.filter((file) => !DEBUG_FILE.test(file)), ...sorted.filter((file) => DEBUG_FILE.test(file))];
}

export class Project {
  constructor({ code, path, modules, debug = false }) {
    this.modules = modules;
    this.texts = new Map();
    if (path) {
      const absolute = resolve(path);
      if (!existsSync(absolute)) throw new Error(`нет файла ${absolute}`);
      const folder = statSync(absolute).isDirectory();
      this.home = folder ? absolute : dirname(absolute);
      if (folder) {
        const files = sources(absolute, debug);
        if (!files.length) throw new Error(`в папке ${absolute} нет файлов .xero`);
        this.name = `${absolute.replaceAll("\\", "/")}/`;
        this.text = files.map((f) => `import "${relative(absolute, f).replaceAll("\\", "/")}"\n`).join("");
      } else {
        this.name = absolute.replaceAll("\\", "/");
        this.text = readFileSync(absolute, "utf8");
      }
    } else if (typeof code === "string") {
      this.home = WORKSPACE;
      this.name = "main.xero";
      this.text = code;
    } else {
      throw new Error("нужен code или path");
    }
    this.texts.set(this.name, this.text);
    this.read = (wanted) => {
      if (wanted.startsWith(CONNECT_PREFIX)) return this.moduleText(wanted.slice(CONNECT_PREFIX.length), true);
      if (wanted.startsWith(MODULE_PREFIX)) return this.moduleText(wanted.slice(MODULE_PREFIX.length), false);
      const file = resolve(this.home, wanted);
      if (!existsSync(file) || !statSync(file).isFile()) return null;
      const text = readFileSync(file, "utf8");
      this.texts.set(wanted, text);
      return text;
    };
  }

  moduleText(wanted, connect) {
    if (!this.modules) return JSON.stringify({ error: `модуль «${wanted}» здесь недоступен` });
    return this.modules(wanted, connect);
  }

  diagnostics(list) {
    return list.map((d) => describe(d, this.texts, this.name));
  }

  check() {
    const diagnostics = this.diagnostics(call("check", this.name, this.text, this.read));
    return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
  }

  build() {
    const r = call("build", this.name, this.text, this.read);
    return {
      ok: r.ok,
      diagnostics: this.diagnostics(r.diagnostics ?? []),
      module: r.module,
      lines: r.lines,
      blocks: r.blocks,
      connected: r.connected ?? [],
    };
  }
}

export const format = (text) => call("format", text);
export const rawFormat = (text) => core.format(text);
export const rawSymbols = (text) => core.symbols(text);
export const rawVariables = (text) => core.variables(text);
export const decompile = (world) => call("decompile", world);
export const plan = (copy, module) => call("plan", copy ?? "", module);
export const symbols = (text) => call("symbols", text);
export const variables = (text) => call("variables", text);

export function applyFixes(text, diagnostics) {
  const edits = diagnostics
    .filter((d) => d.fixes?.length)
    .map((d) => d.fixes[0])
    .sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  let applied = 0;
  for (const edit of edits) {
    if (edit.end > floor) continue;
    out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);
    floor = edit.start;
    applied++;
  }
  return { text: out, applied };
}
