#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { applyEdits, findNodeAtLocation, format, modify, parse as parseJsonc, parseTree } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import YAML from "yaml";
import { DB_FILE, GUIDE, RAW, REFERENCE, ROOT, WORKSPACE } from "../src/paths.mjs";

const NAME = "justmc";
const NODE = process.execPath;
const SERVER = join(ROOT, "src", "index.mjs");
const LONG_MS = 900000;
const LONG_S = 900;
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");
const XDG = process.env.XDG_CONFIG_HOME || join(HOME, ".config");
const MARK = ".justmc-mcp";
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const COPILOT_HARNESS = [1, 143];

const flags = new Set(process.argv.slice(2).filter((a) => !a.includes("=")));
const options = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes("=")).map((a) => a.replace(/^--/, "").split("=")));
const DRY = flags.has("--dry");
const REMOVE = flags.has("--remove");
const ALL = flags.has("--all");
const ONLY = options.only ? new Set(options.only.split(",")) : null;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

class Problem extends Error {}

const env = (name, fallback) => process.env[name] || fallback;
const exists = (...paths) => paths.some((p) => p && existsSync(p));
const plain = () => ({ command: NODE, args: [SERVER] });

function which(...names) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = WIN ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const path = join(dir, name + ext.toLowerCase());
        if (existsSync(path) && statSync(path).isFile()) return path;
      }
    }
  }
  return null;
}

function run(exe, args, timeout = 60000) {
  const batch = WIN && /\.(cmd|bat)$/i.test(exe);
  const result = batch
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${[exe, ...args].map((a) => `"${a}"`).join(" ")}"`],
        { encoding: "utf8", timeout, windowsVerbatimArguments: true, windowsHide: true })
    : spawnSync(exe, args, { encoding: "utf8", timeout, windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function versionOf(exe) {
  if (!exe) return null;
  const m = run(exe, ["--version"], 20000).text.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

const older = (v, than) => v && (v[0] < than[0] || (v[0] === than[0] && v[1] < than[1]));

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function backup(file, tool) {
  if (DRY || !existsSync(file)) return;
  const dir = join(WORKSPACE, "config-backups");
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, join(dir, `${STAMP}-${tool}-${basename(file)}`));
}

function save(file, text, tool) {
  if (DRY) return;
  backup(file, tool);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function indentOf(text) {
  const m = text.match(/^([ \t]+)\S/m);
  if (!m) return { insertSpaces: true, tabSize: 2 };
  return m[1].includes("\t") ? { insertSpaces: false, tabSize: 1 } : { insertSpaces: true, tabSize: m[1].length };
}

function tidy(text, path, formattingOptions) {
  const property = findNodeAtLocation(parseTree(text, [], { allowTrailingComma: true }), path)?.parent;
  const container = property?.parent;
  if (!container || property.type !== "property") return text;
  const index = container.children.indexOf(property);
  const before = container.children[index - 1];
  const start = before ? before.offset + before.length : container.offset;
  const last = index === container.children.length - 1;
  const end = last ? container.offset + container.length : property.offset + property.length;
  return applyEdits(text, format(text, { offset: start, length: end - start }, formattingOptions));
}

function editJson(file, changes, tool) {
  const original = readText(file);
  const bom = original.startsWith("﻿") ? "﻿" : "";
  const text = original.slice(bom.length);
  const errors = [];
  const data = text.trim() ? parseJsonc(text, errors, { allowTrailingComma: true }) : {};
  if (errors.length || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Problem(`${file}: не разобрать JSON, файл не тронут`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const formattingOptions = { ...indentOf(text), eol };
  let out = text.trim() ? text : `{}${eol}`;
  for (const { path, value, when } of changes) {
    const at = (depth) => path.slice(0, depth).reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), data);
    const current = at(path.length);
    if (when && !when(current)) continue;
    if (value === undefined && current === undefined) continue;
    if (value !== undefined && same(current, value)) continue;
    out = applyEdits(out, modify(out, path, value, {}));
    if (value === undefined) continue;
    let depth = 1;
    while (depth < path.length && at(depth) !== undefined) depth++;
    out = tidy(out, path.slice(0, depth), formattingOptions);
  }
  if (out === text || (!text.trim() && out === `{}${eol}`)) return false;
  save(file, bom + out, tool);
  return true;
}

function tomlValue(value) {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function tomlLines(header, body) {
  return [header, ...Object.entries(body).map(([k, v]) => `${k} = ${tomlValue(v)}`)];
}

function parseTomlOrFail(text, file) {
  try {
    return parseToml(text);
  } catch (e) {
    throw new Problem(`${file}: не разобрать TOML (${e.message.split("\n")[0]}), файл не тронут`);
  }
}

function finishToml(file, original, lines, check, tool) {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const out = lines.length ? lines.join(eol) + eol : "";
  if (out === original) return false;
  if (!check(parseTomlOrFail(out, file))) throw new Problem(`${file}: правка вышла неверной, файл не тронут`);
  save(file, out, tool);
  return true;
}

function editTomlTable(file, table, body, tool) {
  const original = readText(file);
  const parsed = parseTomlOrFail(original, file);
  const current = table.split(".").reduce((node, key) => node?.[key], parsed);
  if (body && same(current, body)) return false;
  if (!body && current === undefined) return false;
  const lines = [];
  let skipping = false;
  for (const line of original.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^[\]]+)\]\s*(?:#.*)?$/);
    if (header || /^\s*\[\[/.test(line)) {
      const name = header ? header[1].replace(/\s+/g, "").replace(/"/g, "") : "";
      skipping = Boolean(header) && (name === table || name.startsWith(`${table}.`));
    }
    if (!skipping) lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (body) lines.push(...(lines.length ? [""] : []), ...tomlLines(`[${table}]`, body));
  const check = (data) => {
    const now = table.split(".").reduce((node, key) => node?.[key], data);
    return body ? same(now, body) : now === undefined;
  };
  return finishToml(file, original, lines, check, tool);
}

function editTomlList(file, list, body, tool) {
  const original = readText(file);
  const parsed = parseTomlOrFail(original, file);
  const mine = (parsed[list] ?? []).filter((s) => s?.name === NAME);
  if (body && mine.length === 1 && same(mine[0], body)) return false;
  if (!body && !mine.length) return false;
  const lines = [];
  let block = null;
  const flush = () => {
    if (!block) return;
    const item = parseTomlOrFail(block.join("\n"), file)[list]?.[0];
    if (item?.name !== NAME) lines.push(...block);
    block = null;
  };
  for (const line of original.split(/\r?\n/)) {
    const isList = new RegExp(`^\\s*\\[\\[\\s*${list}\\s*\\]\\]`).test(line);
    const isSub = new RegExp(`^\\s*\\[\\s*${list}\\.`).test(line);
    const isHeader = /^\s*\[/.test(line);
    if (isList) {
      flush();
      block = [line];
      continue;
    }
    if (block && isHeader && !isSub) flush();
    if (block) block.push(line);
    else lines.push(line);
  }
  flush();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (body) lines.push(...(lines.length ? [""] : []), ...tomlLines(`[[${list}]]`, body));
  const check = (data) => {
    const now = (data[list] ?? []).filter((s) => s?.name === NAME);
    return body ? now.length === 1 && same(now[0], body) : now.length === 0;
  };
  return finishToml(file, original, lines, check, tool);
}

function yamlDocument(file) {
  const doc = YAML.parseDocument(readText(file));
  if (doc.errors.length) throw new Problem(`${file}: не разобрать YAML, файл не тронут`);
  return doc;
}

function editYamlMap(file, path, value, tool) {
  const doc = yamlDocument(file);
  const current = doc.getIn(path);
  const now = current && typeof current.toJSON === "function" ? current.toJSON() : current;
  if (value === undefined ? now === undefined : same(now, value)) return false;
  if (value === undefined) doc.deleteIn(path);
  else if (doc.contents === null) doc.contents = doc.createNode({ [path[0]]: { [path[1]]: value } });
  else doc.setIn(path, doc.createNode(value));
  save(file, doc.toString(), tool);
  return true;
}

function editYamlList(file, key, value, tool) {
  const doc = yamlDocument(file);
  const list = doc.toJS()?.[key] ?? [];
  const at = Array.isArray(list) ? list.findIndex((s) => s?.name === NAME) : -1;
  if (value === undefined && at < 0) return false;
  if (value !== undefined && at >= 0 && same(list[at], value)) return false;
  if (value === undefined) doc.deleteIn([key, at]);
  else if (at >= 0) doc.setIn([key, at], doc.createNode(value));
  else if (Array.isArray(list) && doc.hasIn([key])) doc.addIn([key], doc.createNode(value));
  else doc.setIn([key], doc.createNode([value]));
  save(file, doc.toString(), tool);
  return true;
}

function editCrushrc(file, tool) {
  const original = readText(file);
  if (!REMOVE && [NODE, SERVER].some((p) => p.includes("'"))) throw new Problem("в пути есть кавычка, crushrc не поправить");
  const slash = (p) => (WIN ? p.replace(/\\/g, "/") : p);
  const line = `mcp add ${NAME} --command '${slash(NODE)}' --args '${slash(SERVER)}' --timeout 60`;
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const kept = original.split(/\r?\n/).filter((l) => !new RegExp(`^\\s*mcp\\s+add\\s+${NAME}(\\s|$)`).test(l));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (!REMOVE) kept.push(line);
  const out = kept.length ? kept.join(eol) + eol : "";
  if (out === original) return false;
  save(file, out, tool);
  return true;
}

function claudeCode(tool) {
  const exe = which("claude");
  if (!exe) throw new Problem("нет команды claude");
  const got = run(exe, ["mcp", "get", NAME]);
  const mine = got.ok && got.text.includes(SERVER);
  if (!REMOVE && mine) return false;
  if (REMOVE && !got.ok) return false;
  if (DRY) return true;
  if (got.ok) {
    const removed = run(exe, ["mcp", "remove", NAME, "-s", "user"]);
    if (!removed.ok && !REMOVE) throw new Problem(`claude mcp remove: ${removed.text.split("\n")[0]}`);
    if (REMOVE) return removed.ok;
  }
  const added = run(exe, ["mcp", "add", "--scope", "user", "--transport", "stdio", NAME, "--", NODE, SERVER]);
  if (!added.ok) throw new Problem(`claude mcp add: ${added.text.split("\n")[0]}`);
  return true;
}

const vscodeUser = (product) => (WIN ? join(APPDATA, product, "User") : MAC ? join(HOME, "Library", "Application Support", product, "User") : join(XDG, product, "User"));
const vscodeExe = () => which("code", "code-insiders");
const crushDir = () => env("CRUSH_GLOBAL_CONFIG", join(XDG, "crush"));
const opencodeDir = () => env("OPENCODE_CONFIG_DIR", join(XDG, "opencode"));
const kiloDir = () => env("KILO_CONFIG_DIR", join(XDG, "kilo"));
const firstExisting = (dir, names) => join(dir, names.find((n) => existsSync(join(dir, n))) ?? names[names.length - 1]);

function opencodeChanges(file) {
  const errors = [];
  const data = parseJsonc(readText(file) || "{}", errors, { allowTrailingComma: true }) ?? {};
  const v2 = data.mcp && typeof data.mcp.servers === "object" && !("type" in data.mcp.servers);
  if (REMOVE) return [{ path: ["mcp", "servers", NAME], value: undefined }, { path: ["mcp", NAME], value: undefined }];
  return v2
    ? [{ path: ["mcp", "servers", NAME], value: { type: "local", command: [NODE, SERVER] } }]
    : [{ path: ["mcp", NAME], value: { type: "local", command: [NODE, SERVER], enabled: true, timeout: LONG_MS } }];
}

function rovodevFile() {
  const dir = join(HOME, ".rovodev");
  try {
    const set = YAML.parse(readText(join(dir, "config.yml")))?.mcp?.mcpConfigPath;
    if (set) return set.replace(/^~(?=[\\/])/, HOME);
  } catch {}
  return firstExisting(dir, ["mcp_config.json", "mcp.json"]);
}

function clineExtensionFiles() {
  return ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"]
    .map((p) => join(vscodeUser(p), "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"))
    .filter((f) => existsSync(f));
}

const SHORT_LIMIT = "вызов дольше 60 с программа обрывает сама: `test` там не дождётся конца";

const TOOLS = [
  {
    id: "claude", title: "Claude Code",
    found: () => which("claude"),
    apply: () => claudeCode("claude"),
    where: () => "claude mcp (user)",
  },
  {
    id: "claude-desktop", title: "Claude Desktop",
    files: () => {
      const store = join(LOCALAPPDATA, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
      const main = WIN ? join(APPDATA, "Claude") : MAC ? join(HOME, "Library", "Application Support", "Claude") : join(XDG, "Claude");
      return [main, ...(WIN && existsSync(store) ? [store] : [])].map((d) => join(d, "claude_desktop_config.json"));
    },
    found: (t) => t.files().some((f) => existsSync(dirname(f))),
    json: () => [{ path: ["mcpServers", NAME], value: plain() }],
    note: "долгий `test` Claude Desktop может оборвать сам",
  },
  {
    id: "codex", title: "Codex CLI",
    files: () => [join(env("CODEX_HOME", join(HOME, ".codex")), "config.toml")],
    found: (t) => which("codex") || exists(dirname(t.files()[0])),
    toml: { table: `mcp_servers.${NAME}`, body: () => ({ ...plain(), startup_timeout_sec: 30, tool_timeout_sec: LONG_S }) },
  },
  {
    id: "gemini", title: "Gemini CLI",
    files: () => [join(env("GEMINI_CLI_HOME", HOME), ".gemini", "settings.json")],
    found: () => which("gemini"),
    note: "в папке без доверия Gemini MCP-серверы не запускает",
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), timeout: LONG_MS } }],
  },
  {
    id: "antigravity", title: "Antigravity",
    files: () => [join(HOME, ".gemini", "config", "mcp_config.json")],
    found: (t) => which("agy") || exists(t.files()[0], join(HOME, ".gemini", "antigravity")),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), timeoutSeconds: LONG_S } }],
  },
  {
    id: "qwen", title: "Qwen Code",
    files: () => [join(env("QWEN_HOME", join(HOME, ".qwen")), "settings.json")],
    found: () => which("qwen"),
    json: () => [
      { path: ["mcpServers", NAME], value: { ...plain(), timeout: LONG_MS } },
      { path: ["mcp", "toolIdleTimeoutMs"], value: LONG_MS, when: (v) => !REMOVE && !(v >= LONG_MS) },
    ],
  },
  {
    id: "copilot", title: "GitHub Copilot CLI и VS Code",
    files: () => [join(env("COPILOT_HOME", join(HOME, ".copilot")), "mcp-config.json")],
    found: (t) => {
      const cli = which("copilot");
      return (cli && !/copilot-shim/i.test(cli)) || vscodeExe() || exists(dirname(t.files()[0]));
    },
    json: () => [{ path: ["mcpServers", NAME], value: { type: "local", ...plain(), tools: ["*"], timeout: LONG_MS } }],
  },
  {
    id: "vscode", title: "VS Code до 1.143",
    files: () => ["Code", "Code - Insiders"].map((p) => join(vscodeUser(p), "mcp.json")),
    found: () => older(versionOf(vscodeExe()), COPILOT_HARNESS),
    json: () => [{ path: ["servers", NAME], value: { type: "stdio", ...plain() } }],
    onlyExistingDirs: true,
  },
  {
    id: "cursor", title: "Cursor",
    files: () => [join(HOME, ".cursor", "mcp.json")],
    found: (t) => which("cursor-agent", "cursor") || exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain() } }],
    note: `в Cursor CLI ${SHORT_LIMIT}`,
  },
  {
    id: "opencode", title: "OpenCode",
    files: () => [firstExisting(opencodeDir(), ["opencode.jsonc", "opencode.json"])],
    found: () => which("opencode") || exists(opencodeDir()),
    json: (file) => opencodeChanges(file),
  },
  {
    id: "kilo", title: "Kilo Code CLI",
    files: () => [firstExisting(kiloDir(), ["kilo.jsonc", "config.json", "opencode.json", "kilo.json"])],
    found: () => which("kilo") || exists(kiloDir()),
    json: () => [{ path: ["mcp", NAME], value: { type: "local", command: [NODE, SERVER], enabled: true, timeout: LONG_MS } }],
  },
  {
    id: "crush", title: "Crush",
    files: () => [existsSync(join(crushDir(), "crush.json")) && !existsSync(join(crushDir(), "crushrc")) ? join(crushDir(), "crush.json") : join(crushDir(), "crushrc")],
    found: () => which("crush") || exists(crushDir()),
    apply: (t) => {
      const file = t.files()[0];
      if (file.endsWith(".json")) return editJson(file, [{ path: ["mcp", NAME], value: REMOVE ? undefined : { type: "stdio", ...plain(), timeout: 60 } }], "crush");
      return editCrushrc(file, "crush");
    },
  },
  {
    id: "goose", title: "Goose",
    files: () => [WIN ? join(APPDATA, "Block", "goose", "config", "config.yaml") : join(XDG, "goose", "config.yaml")],
    found: (t) => exists(dirname(t.files()[0])),
    apply: (t) => editYamlMap(t.files()[0], ["extensions", NAME], REMOVE ? undefined : {
      type: "stdio", name: NAME, enabled: true, cmd: NODE, args: [SERVER], envs: {}, env_keys: [], timeout: LONG_S,
    }, "goose"),
  },
  {
    id: "amp", title: "Amp",
    files: () => [firstExisting(join(HOME, ".config", "amp"), ["settings.jsonc", "settings.json"])],
    found: () => which("amp") || exists(join(HOME, ".config", "amp")),
    json: () => [{ path: ["amp.mcpServers", NAME], value: plain() }],
  },
  {
    id: "kiro", title: "Kiro",
    files: () => [join(env("KIRO_HOME", join(HOME, ".kiro")), "settings", "mcp.json")],
    found: () => which("kiro-cli", "kiro") || exists(env("KIRO_HOME", join(HOME, ".kiro"))),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), env: {}, disabled: false, timeout: LONG_MS, requestTimeout: LONG_MS } }],
  },
  {
    id: "amazon-q", title: "Amazon Q Developer CLI",
    files: () => [join(HOME, ".aws", "amazonq", "mcp.json")],
    found: (t) => which("q") && exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), timeout: LONG_MS } }],
  },
  {
    id: "droid", title: "Factory Droid",
    files: () => [join(HOME, ".factory", "mcp.json")],
    found: (t) => which("droid") || exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain(), timeout: LONG_MS } }],
  },
  {
    id: "auggie", title: "Augment Auggie",
    files: () => [join(HOME, ".augment", "settings.json")],
    found: (t) => which("auggie") || exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain() } }],
  },
  {
    id: "cline", title: "Cline",
    files: () => [
      process.env.CLINE_MCP_SETTINGS_PATH || join(env("CLINE_DIR", join(HOME, ".cline")), "data", "settings", "cline_mcp_settings.json"),
      ...clineExtensionFiles(),
    ],
    found: () => which("cline") || exists(env("CLINE_DIR", join(HOME, ".cline"))) || clineExtensionFiles().length > 0,
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain(), disabled: false, autoApprove: [], timeout: LONG_S } }],
  },
  {
    id: "continue", title: "Continue",
    files: () => [join(env("CONTINUE_GLOBAL_DIR", join(HOME, ".continue")), "config.yaml")],
    found: (t) => existsSync(t.files()[0]),
    apply: (t) => editYamlList(t.files()[0], "mcpServers", REMOVE ? undefined : { name: NAME, type: "stdio", ...plain() }, "continue"),
    note: `в Continue ${SHORT_LIMIT}`,
  },
  {
    id: "devin", title: "Devin Desktop и Devin CLI (бывший Windsurf)",
    files: () => [
      WIN ? join(APPDATA, "devin", "mcp_config.json") : join(XDG, "devin", "mcp_config.json"),
      ...[join(HOME, ".codeium", "windsurf", "mcp_config.json")].filter((f) => existsSync(f)),
    ],
    found: (t) => which("devin") || exists(dirname(t.files()[0])) || t.files().length > 1,
    json: () => [{ path: ["mcpServers", NAME], value: plain() }],
  },
  {
    id: "zed", title: "Zed",
    files: () => [WIN ? join(APPDATA, "Zed", "settings.json") : MAC ? join(HOME, ".config", "zed", "settings.json") : join(XDG, "zed", "settings.json")],
    found: (t) => exists(dirname(t.files()[0])),
    json: () => [{ path: ["context_servers", NAME], value: { ...plain(), env: {}, timeout: 600 } }],
    note: "Zed не ждёт вызова дольше 10 минут",
  },
  {
    id: "warp", title: "Warp",
    files: () => [join(HOME, ".warp", ".mcp.json")],
    found: (t) => exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: plain() }],
  },
  {
    id: "rovodev", title: "Rovo Dev CLI",
    files: () => [rovodevFile()],
    found: () => exists(join(HOME, ".rovodev")),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), transport: "stdio" } }],
  },
  {
    id: "kimi", title: "Kimi Code CLI",
    files: () => [join(env("KIMI_CODE_HOME", join(HOME, ".kimi-code")), "mcp.json")],
    found: (t) => exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), toolTimeoutMs: LONG_MS } }],
  },
  {
    id: "vibe", title: "Mistral Vibe",
    files: () => [join(env("VIBE_HOME", join(HOME, ".vibe")), "config.toml")],
    found: (t) => which("vibe") || exists(dirname(t.files()[0])),
    apply: (t) => editTomlList(t.files()[0], "mcp_servers", REMOVE ? null : {
      name: NAME, transport: "stdio", command: [NODE], args: [SERVER], tool_timeout_sec: LONG_S,
    }, "vibe"),
  },
  {
    id: "qoder", title: "Qoder CLI",
    files: () => [join(HOME, ".qoder", "settings.json")],
    found: (t) => which("qoder", "qodercli") || exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain(), timeout: LONG_MS } }],
  },
  {
    id: "junie", title: "Junie CLI",
    files: () => [join(HOME, ".junie", "mcp", "mcp.json")],
    found: () => which("junie") || exists(join(HOME, ".junie")),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), timeout: LONG_MS } }],
  },
  {
    id: "grok", title: "Grok CLI",
    files: () => [join(env("GROK_HOME", join(HOME, ".grok")), "config.toml")],
    found: (t) => existsSync(t.files()[0]),
    toml: { table: `mcp_servers.${NAME}`, body: () => ({ ...plain(), tool_timeout_sec: LONG_S }) },
  },
  {
    id: "pi", title: "Pi",
    files: () => [join(env("PI_CODING_AGENT_DIR", join(HOME, ".pi", "agent")), "mcp.json")],
    found: (t) => exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { ...plain(), timeout: LONG_S } }],
  },
  {
    id: "cortex", title: "Snowflake Cortex Code",
    files: () => [join(HOME, ".snowflake", "cortex", "mcp.json")],
    found: (t) => exists(dirname(t.files()[0])),
    json: () => [{ path: ["mcpServers", NAME], value: { type: "stdio", ...plain(), timeout: LONG_MS } }],
  },
];

const SKILLS = [
  { dir: () => join(HOME, ".agents", "skills"), when: () => true },
  { dir: () => join(env("CLAUDE_CONFIG_DIR", join(HOME, ".claude")), "skills"), when: (on) => on.has("claude") || exists(env("CLAUDE_CONFIG_DIR", join(HOME, ".claude"))) },
  { dir: () => join(HOME, ".gemini", "config", "skills"), when: (on) => on.has("antigravity") },
  { dir: () => join(env("KIRO_HOME", join(HOME, ".kiro")), "skills"), when: (on) => on.has("kiro") },
  { dir: () => join(env("COPILOT_HOME", join(HOME, ".copilot")), "skills"), when: () => Boolean(vscodeExe()) },
  { dir: () => join(env("CLINE_DIR", join(HOME, ".cline")), "skills"), when: (on) => on.has("cline") },
  { dir: () => join(env("PI_CODING_AGENT_DIR", join(HOME, ".pi", "agent")), "skills"), when: (on) => on.has("pi") },
];

function applyTool(tool) {
  if (tool.apply) return tool.apply(tool);
  let changed = false;
  let touched = 0;
  for (const file of tool.files()) {
    if (tool.onlyExistingDirs && !existsSync(dirname(file))) continue;
    if (REMOVE && !existsSync(file)) continue;
    touched++;
    if (tool.toml) changed = editTomlTable(file, tool.toml.table, REMOVE ? null : tool.toml.body(), tool.id) || changed;
    else {
      const changes = tool.json(file).map((c) => (REMOVE && c.path.at(-1) === NAME ? { ...c, value: undefined } : c));
      changed = editJson(file, REMOVE ? changes.filter((c) => c.path.at(-1) === NAME) : changes, tool.id) || changed;
    }
  }
  if (!touched && !REMOVE) throw new Problem("нет папки с настройками");
  return changed;
}

function withContents(text) {
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => `- ${m[1].trim()}`);
  const end = text.indexOf("\n") + 1;
  return `${text.slice(0, end)}\nСодержание:\n${headings.join("\n")}\n${text.slice(end)}`;
}

function ours(dir) {
  if (existsSync(join(dir, MARK))) return true;
  const head = readText(join(dir, "SKILL.md")).match(/^---\r?\n[\s\S]*?\r?\n---/);
  return Boolean(head && /^name:\s*["']?justmc["']?\s*$/m.test(head[0]));
}

function placeSkill(root) {
  const dir = join(root, NAME);
  if (existsSync(dir) && !ours(dir)) throw new Problem(`${dir}: там чужой скилл с тем же именем, не тронут`);
  if (REMOVE) {
    if (!existsSync(dir)) return false;
    if (!DRY) rmSync(dir, { recursive: true, force: true });
    return true;
  }
  if (DRY) return true;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  cpSync(join(ROOT, "skill", "SKILL.md"), join(dir, "SKILL.md"));
  for (const f of readdirSync(GUIDE).filter((n) => n.endsWith(".md"))) {
    writeFileSync(join(dir, "references", f), withContents(readFileSync(join(GUIDE, f), "utf8")));
  }
  writeFileSync(join(dir, MARK), `${VERSION}\n`);
  return true;
}

function newest(dir) {
  if (!existsSync(dir)) return 0;
  let best = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    best = Math.max(best, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return best;
}

function script(name, quiet = false) {
  const result = spawnSync(NODE, [join(ROOT, "scripts", name)], { stdio: quiet ? "pipe" : "inherit", cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0 && quiet) console.log(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split(/\r?\n/).slice(-8).join("\n"));
  return result.status === 0;
}

function knowledge() {
  if (REMOVE || DRY) return null;
  if (flags.has("--modules") && !script("crawl.mjs")) return "модули не докачались: продолжить — npm run crawl";
  const built = existsSync(DB_FILE) ? statSync(DB_FILE).mtimeMs : 0;
  if (built && !flags.has("--modules") && Math.max(newest(REFERENCE), newest(RAW)) <= built) return null;
  console.log("Собираю базу знаний…");
  return script("learn.mjs", true) ? null : "база знаний не собралась: закрой программы с запущенным MCP и запусти npm run learn";
}

function main() {
  console.log(`JustMC MCP ${VERSION}${DRY ? " (проба, без записи)" : ""}`);
  console.log(`сервер: ${NODE} ${SERVER}\n`);
  const trouble = knowledge();
  const rows = [];
  const on = new Set();
  const missing = [];
  for (const tool of TOOLS) {
    if (ONLY && !ONLY.has(tool.id)) continue;
    let found = false;
    try {
      found = ALL || Boolean(tool.found(tool)) || (REMOVE && Boolean(tool.files?.().some((f) => existsSync(f))));
    } catch {}
    if (!found) {
      missing.push(tool.title);
      continue;
    }
    on.add(tool.id);
    try {
      const changed = applyTool(tool);
      const what = REMOVE
        ? changed ? (DRY ? "будет убран" : "убран") : "не был подключён"
        : changed ? (DRY ? "будет подключён" : "подключён") : "уже подключён";
      rows.push(["✓", tool.title, tool.note && !REMOVE ? `${what}; ${tool.note}` : what]);
    } catch (e) {
      rows.push(["✗", tool.title, e instanceof Problem ? e.message : `ошибка: ${e.message}`]);
    }
  }
  const width = Math.max(...rows.map((r) => r[1].length), 10);
  for (const [mark, title, text] of rows) console.log(`  ${mark} ${title.padEnd(width)}  ${text}`);
  if (!rows.length) console.log("  ни одной знакомой программы не нашлось");

  const placed = [];
  for (const skill of SKILLS) {
    if (!REMOVE && !ALL && !skill.when(on)) continue;
    try {
      if (placeSkill(skill.dir())) placed.push(skill.dir());
    } catch (e) {
      console.log(`  ✗ скилл: ${e.message}`);
    }
  }
  if (placed.length) console.log(`\nСкилл ${NAME} ${REMOVE ? "убран из" : "лежит в"}: ${placed.join(", ")}`);
  if (missing.length && !REMOVE) console.log(`\nНе найдены: ${missing.join(", ")}.`);
  if (trouble) console.log(`\n${trouble}`);
  if (!REMOVE) {
    console.log("\nПерезапусти программы, чтобы они подхватили сервер. Другая программа: команда");
    console.log(`  ${NODE} ${SERVER}`);
    if (!existsSync(RAW) || !readdirSync(RAW).length) console.log(`Примеры чужого кода (examples): ${NODE} ${join(ROOT, "scripts", "setup.mjs")} --modules, около 50 минут.`);
  }
  if (rows.some((r) => r[0] === "✗") || trouble) process.exitCode = 1;
}

main();
