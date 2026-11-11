import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { DATA, DB_FILE, RAW, REFERENCE } from "../src/paths.mjs";
import { Project, decompile, symbols } from "../src/xero/core.mjs";
import { functionDocs, moduleText, moduleTitle } from "../src/knowledge/modules.mjs";
import { loadReference } from "../src/knowledge/reference.mjs";
import { indexText, tokens } from "../src/knowledge/stem.mjs";
import { tagsOf } from "../src/knowledge/tags.mjs";

const MIN_PAIR_MODULES = 2;
const MIN_NEXT_MODULES = 3;
const MIN_IDIOM_MODULES = 6;
const MIN_WORD_MODULES = 3;
const MIN_ASSOC = 3;
const TOP_VALUES = 8;
const TOP_NEXT = 6;
const TOP_ASSOC = 12;
const IDIOM_LENGTHS = [3, 4, 5];
const CONTROL = /^(?:control_wait|control_end_thread|control_call_exception|else|repeat_|set_variable_value|set_variable_multiple|if_variable_equals|empty|call_function|start_process)/;

const TEMP = `${DB_FILE}.new`;
for (const f of [TEMP, `${TEMP}-wal`, `${TEMP}-shm`]) rmSync(f, { force: true });
const db = new Database(TEMP);
db.exec(`
PRAGMA journal_mode=OFF;
PRAGMA synchronous=OFF;
CREATE TABLE ref(id INTEGER PRIMARY KEY, kind TEXT, name TEXT, title TEXT, section TEXT, summary TEXT, body TEXT, uses INTEGER DEFAULT 0, modules INTEGER DEFAULT 0);
CREATE INDEX ref_name ON ref(name);
CREATE VIRTUAL TABLE ref_fts USING fts5(name, title, summary, body, content='', tokenize="unicode61 remove_diacritics 0");
CREATE TABLE module(id TEXT PRIMARY KEY, name TEXT, title TEXT, about TEXT, category TEXT, author TEXT, installs INTEGER, stars INTEGER, updated TEXT, lines INTEGER, blocks INTEGER, clean INTEGER, raws INTEGER, tags TEXT, entry TEXT, xero TEXT);
CREATE INDEX module_name ON module(name COLLATE NOCASE);
CREATE TABLE chunk(id INTEGER PRIMARY KEY, module TEXT, kind TEXT, name TEXT, line INTEGER, length INTEGER, weight REAL, doc TEXT, tags TEXT, shape TEXT, code TEXT);
CREATE INDEX chunk_module ON chunk(module);
CREATE INDEX chunk_shape ON chunk(shape);
CREATE VIRTUAL TABLE chunk_fts USING fts5(name, about, code, content='', tokenize="unicode61 remove_diacritics 0");
CREATE TABLE usage(symbol TEXT, chunk INTEGER, count INTEGER);
CREATE INDEX usage_symbol ON usage(symbol, chunk);
CREATE INDEX usage_chunk ON usage(chunk);
CREATE TABLE pair(event TEXT, symbol TEXT, modules INTEGER);
CREATE INDEX pair_event ON pair(event);
CREATE TABLE arg_fill(symbol TEXT, arg TEXT, modules INTEGER);
CREATE INDEX arg_fill_symbol ON arg_fill(symbol);
CREATE TABLE arg_value(symbol TEXT, arg TEXT, value TEXT, modules INTEGER);
CREATE INDEX arg_value_symbol ON arg_value(symbol);
CREATE TABLE next_step(symbol TEXT, next TEXT, modules INTEGER);
CREATE INDEX next_step_symbol ON next_step(symbol);
CREATE TABLE idiom(id INTEGER PRIMARY KEY, steps TEXT, length INTEGER, modules INTEGER, chunk INTEGER);
CREATE TABLE idiom_symbol(symbol TEXT, idiom INTEGER);
CREATE INDEX idiom_symbol_symbol ON idiom_symbol(symbol);
CREATE TABLE assoc(word TEXT, symbol TEXT, score REAL, together INTEGER);
CREATE INDEX assoc_word ON assoc(word);
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
`);

function loadNames() {
  const names = new Map();
  const row = /^\| \*\*`([^`]+)`\*\* \| `([^`]+)`/;
  for (const line of readFileSync(join(REFERENCE, "NAMES.md"), "utf8").split(/\r?\n/)) {
    const m = line.match(row);
    if (m) names.set(m[2], m[1]);
    const spare = line.match(/сервер ставит `([^`]+)`/);
    if (m && spare) names.set(spare[1], m[1]);
  }
  return names;
}

const reference = loadReference();
const insertRef = db.prepare("INSERT INTO ref(kind,name,title,section,summary,body) VALUES(?,?,?,?,?,?)");
const insertRefFts = db.prepare("INSERT INTO ref_fts(rowid,name,title,summary,body) VALUES(?,?,?,?,?)");
db.exec("BEGIN");
for (const r of reference) {
  const { lastInsertRowid: id } = insertRef.run(r.kind, r.name, r.title, r.section, r.summary, r.body);
  insertRefFts.run(id, indexText(r.name), indexText(r.title), indexText(r.summary), indexText(r.body));
}
db.exec("COMMIT");
const known = new Set(reference.map((r) => r.name));
const idName = loadNames();
const nameOf = (id) => idName.get(id) ?? id;

const catalog = new Map(JSON.parse(readFileSync(join(DATA, "catalog.json"), "utf8")).modules.map((m) => [m.id, m]));
const insertModule = db.prepare("INSERT INTO module VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const insertChunk = db.prepare("INSERT INTO chunk(module,kind,name,line,length,weight,doc,tags,shape,code) VALUES(?,?,?,?,?,?,?,?,?,?)");
const insertChunkFts = db.prepare("INSERT INTO chunk_fts(rowid,name,about,code) VALUES(?,?,?,?)");
const insertUsage = db.prepare("INSERT INTO usage VALUES(?,?,?)");

const CALL = /(?<![\w.`])([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)\(/g;
const VALUE = /\bvalue\.[a-z0-9_]+/g;
const PLACEHOLDER = /%[a-z_]+(?:%|\()/g;

function used(code) {
  const out = new Map();
  const bump = (s) => out.set(s, (out.get(s) ?? 0) + 1);
  for (const m of code.matchAll(CALL)) if (known.has(m[1])) bump(m[1]);
  for (const m of code.matchAll(VALUE)) if (known.has(m[0])) bump(m[0]);
  for (const m of code.matchAll(PLACEHOLDER)) {
    const name = m[0].endsWith("(") ? `${m[0]}…)` : m[0];
    if (known.has(name)) bump(name);
  }
  return out;
}

const lineStarts = (text) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
};
const lineOf = (starts, offset) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

const shapeOf = (code) =>
  createHash("sha1")
    .update(code.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`[^`]*`/g, "v").replace(/\b\d+(?:\.\d+)?\b/g, "0").replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 16);

const short = (s) => (s.length <= 44 ? s : null);

function literal(v) {
  if (!v || typeof v !== "object") return null;
  switch (v.type) {
    case "text": return v.text ? short(`"${String(v.text).replaceAll("\n", " ")}"`) : null;
    case "number": return typeof v.number === "number" ? String(v.number) : short(String(v.number ?? ""));
    case "enum": return String(v.enum ?? "").toLowerCase() || null;
    case "vector": return `vec(${v.x}, ${v.y}, ${v.z})`;
    case "block": return v.block ? `block(${String(v.block).replace("minecraft:", "")})` : null;
    case "sound": return v.sound ? `sound(${v.sound})` : null;
    case "particle": return v.particle ? `particle(${String(v.particle).toLowerCase()})` : null;
    case "potion": return v.potion ? `potion(${v.potion})` : null;
    case "game_value": return `value.${v.game_value}`;
    case "variable": return "переменная";
    case "location": return "место";
    case "item": return "предмет";
    default: return null;
  }
}

const isEmpty = (v) => !v || (typeof v === "object" && !Object.keys(v).length);

const fill = new Map();
const values = new Map();
const nexts = new Map();
const grams = new Map();

const bumpSet = (map, key, id) => {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(id);
};

function observe(moduleId, operations, seenGrams) {
  const row = [];
  for (const op of operations ?? []) {
    const id = op.action;
    if (!id) continue;
    const symbol = nameOf(id);
    row.push(id);
    for (const { name, value } of op.values ?? []) {
      if (isEmpty(value)) continue;
      bumpSet(fill, `${symbol}\0${name}`, moduleId);
      const list = value.type === "array" ? (value.values ?? []).filter((v) => !isEmpty(v)).slice(0, 3) : [value];
      for (const v of list) {
        const text = literal(v);
        if (text) bumpSet(values, `${symbol}\0${name}\0${text}`, moduleId);
      }
    }
    observe(moduleId, op.operations, seenGrams);
  }
  for (let i = 0; i + 1 < row.length; i++) bumpSet(nexts, `${nameOf(row[i])}\0${nameOf(row[i + 1])}`, moduleId);
  for (const n of IDIOM_LENGTHS) {
    for (let i = 0; i + n <= row.length; i++) {
      const gram = row.slice(i, i + n);
      if (gram.filter((a) => !CONTROL.test(a)).length < n - 1) continue;
      if (new Set(gram).size < 2) continue;
      seenGrams.add(gram.map(nameOf).join(" → "));
    }
  }
}

const stats = { files: 0, clean: 0, broken: 0, crashed: 0, chunks: 0, duplicates: 0, bytes: 0, raws: 0 };
const moduleUses = new Map();
const symbolUses = new Map();
const pairs = new Map();
const wordModules = new Map();
const symbolModules = new Map();
const wordSymbol = new Map();
const firstChunk = new Map();
const shapes = new Set();
const files = readdirSync(RAW).filter((f) => f.endsWith(".json.gz"));
const started = Date.now();

db.exec("BEGIN");
for (const file of files) {
  const id = file.slice(0, -".json.gz".length);
  const meta = catalog.get(id) ?? { id, name: id };
  stats.files++;
  const json = gunzipSync(readFileSync(join(RAW, file))).toString("utf8");
  let text;
  let info;
  try {
    info = decompile(json);
    text = info.text;
  } catch {
    stats.crashed++;
    continue;
  }
  if (!text.trim()) continue;
  const docs = functionDocs(json);
  let clean = 0;
  try {
    clean = new Project({ code: text }).check().ok ? 1 : 0;
  } catch {
    clean = 0;
  }
  clean ? stats.clean++ : stats.broken++;
  const raws = (text.match(/\braw\("/g) ?? []).length;
  stats.raws += raws;
  stats.bytes += text.length;
  const title = moduleTitle(meta);
  const about = moduleText(meta);
  const installs = meta.history ?? 0;
  const stars = meta.stars ?? 0;
  const fame = Math.log10(installs + 1) + Math.log10(stars + 1) * 0.5;
  const starts = lineStarts(text);
  const seenSymbols = new Set();
  const seenGrams = new Set();
  const moduleTags = new Set();
  let list = [];
  try {
    list = symbols(text);
  } catch {
    list = [];
  }
  const rows = [];
  for (const s of list) {
    if (!["event", "function", "process"].includes(s.kind)) continue;
    const code = text.slice(s.start, s.end);
    const line = lineOf(starts, s.start);
    const length = code.split("\n").length;
    const dirt = (code.match(/\braw\("/g) ?? []).length;
    const shape = shapeOf(code);
    const duplicate = shapes.has(shape);
    shapes.add(shape);
    if (duplicate) stats.duplicates++;
    const weight = fame + (clean ? 1 : 0) - Math.min(dirt, 5) * 0.4 - (duplicate ? 0.8 : 0) - (length > 80 ? 0.4 : 0);
    const doc = docs.get(s.name) ?? "";
    const symbolsHere = used(code);
    const tags = tagsOf(symbolsHere.keys(), s.kind === "event" ? s.name : "");
    for (const t of tags) moduleTags.add(t);
    rows.push({ s, code, line, length, weight, doc, tags, shape, symbolsHere });
  }
  insertModule.run(
    id, meta.name ?? id, title, about, meta.category ?? "", meta.author ?? "", installs, stars, meta.updatedAt ?? "",
    info.lines ?? 0, info.blocks ?? 0, clean, raws, [...moduleTags].join(" "), JSON.stringify(meta), text,
  );
  const moduleWords = new Set(tokens(`${title} ${about}`, { parts: false }));
  for (const r of rows) {
    const { s, code, line, length, weight, doc, tags, shape, symbolsHere } = r;
    const { lastInsertRowid: chunkId } = insertChunk.run(id, s.kind, s.name, line, length, weight, doc, tags.join(" "), shape, code);
    insertChunkFts.run(chunkId, indexText(s.name), indexText(`${title} ${about} ${doc} ${tags.join(" ")}`), indexText(code));
    stats.chunks++;
    const words = new Set([...moduleWords, ...tokens(`${s.name} ${doc}`, { parts: true })]);
    for (const w of words) bumpSet(wordModules, w, id);
    for (const [symbol, count] of symbolsHere) {
      insertUsage.run(symbol, chunkId, count);
      seenSymbols.add(symbol);
      symbolUses.set(symbol, (symbolUses.get(symbol) ?? 0) + count);
      if (!firstChunk.has(symbol)) firstChunk.set(symbol, chunkId);
      if (s.kind === "event") bumpSet(pairs, `${s.name}\0${symbol}`, id);
      bumpSet(symbolModules, symbol, id);
      for (const w of words) bumpSet(wordSymbol, `${w}\0${symbol}`, id);
    }
    if (s.kind === "event" && known.has(s.name)) {
      seenSymbols.add(s.name);
      symbolUses.set(s.name, (symbolUses.get(s.name) ?? 0) + 1);
      insertUsage.run(s.name, chunkId, 1);
      bumpSet(symbolModules, s.name, id);
      for (const w of words) bumpSet(wordSymbol, `${w}\0${s.name}`, id);
    }
  }
  for (const s of seenSymbols) moduleUses.set(s, (moduleUses.get(s) ?? 0) + 1);
  try {
    const safe = json.replace(/:\s*-?Infinity/g, ":null").replace(/:\s*NaN/g, ":null");
    for (const h of JSON.parse(safe).handlers ?? []) observe(id, h.operations, seenGrams);
  } catch {
    stats.broken++;
  }
  for (const g of seenGrams) {
    bumpSet(grams, g, id);
  }
  if (stats.files % 100 === 0) console.log(`${stats.files}/${files.length}, ${((Date.now() - started) / 1000).toFixed(0)} с`);
}
db.exec("COMMIT");

db.exec("BEGIN");
const setUses = db.prepare("UPDATE ref SET uses=?, modules=? WHERE name=?");
for (const [symbol, uses] of symbolUses) setUses.run(uses, moduleUses.get(symbol) ?? 0, symbol);

const insertPair = db.prepare("INSERT INTO pair VALUES(?,?,?)");
for (const [key, set] of pairs) {
  if (set.size < MIN_PAIR_MODULES) continue;
  const [event, symbol] = key.split("\0");
  insertPair.run(event, symbol, set.size);
}

const insertFill = db.prepare("INSERT INTO arg_fill VALUES(?,?,?)");
for (const [key, set] of fill) {
  const [symbol, arg] = key.split("\0");
  insertFill.run(symbol, arg, set.size);
}

const byArg = new Map();
for (const [key, set] of values) {
  const [symbol, arg, value] = key.split("\0");
  const group = `${symbol}\0${arg}`;
  if (!byArg.has(group)) byArg.set(group, []);
  byArg.get(group).push([value, set.size]);
}
const insertValue = db.prepare("INSERT INTO arg_value VALUES(?,?,?,?)");
for (const [group, list] of byArg) {
  const [symbol, arg] = group.split("\0");
  list.sort((a, b) => b[1] - a[1]);
  for (const [value, modules] of list.slice(0, TOP_VALUES)) insertValue.run(symbol, arg, value, modules);
}

const byFirst = new Map();
for (const [key, set] of nexts) {
  if (set.size < MIN_NEXT_MODULES) continue;
  const [symbol, next] = key.split("\0");
  if (!byFirst.has(symbol)) byFirst.set(symbol, []);
  byFirst.get(symbol).push([next, set.size]);
}
const insertNext = db.prepare("INSERT INTO next_step VALUES(?,?,?)");
for (const [symbol, list] of byFirst) {
  list.sort((a, b) => b[1] - a[1]);
  for (const [next, modules] of list.slice(0, TOP_NEXT)) insertNext.run(symbol, next, modules);
}

const strong = [...grams.entries()].filter(([, set]) => set.size >= MIN_IDIOM_MODULES).sort((a, b) => b[1].size - a[1].size);
const kept = [];
for (const [steps, set] of strong) {
  const dominated = kept.some((k) => k.steps.includes(steps) && k.modules >= set.size * 0.8);
  if (!dominated) kept.push({ steps, modules: set.size });
}
const insertIdiom = db.prepare("INSERT INTO idiom(steps,length,modules,chunk) VALUES(?,?,?,?)");
const insertIdiomSymbol = db.prepare("INSERT INTO idiom_symbol VALUES(?,?)");
for (const k of kept) {
  const parts = k.steps.split(" → ");
  const { lastInsertRowid: idiomId } = insertIdiom.run(k.steps, parts.length, k.modules, firstChunk.get(parts[0]) ?? null);
  for (const s of new Set(parts)) insertIdiomSymbol.run(s, idiomId);
}

const totalModules = stats.files;
const scored = new Map();
for (const [key, set] of wordSymbol) {
  const together = set.size;
  if (together < MIN_ASSOC) continue;
  const [word, symbol] = key.split("\0");
  const wordCount = wordModules.get(word)?.size ?? 0;
  const symbolCount = symbolModules.get(symbol)?.size ?? 0;
  if (wordCount < MIN_WORD_MODULES || !symbolCount) continue;
  const pmi = Math.log2((together * totalModules) / (wordCount * symbolCount));
  if (pmi < 1) continue;
  const score = pmi * Math.log2(1 + together);
  if (!scored.has(word)) scored.set(word, []);
  scored.get(word).push([symbol, score, together]);
}
const insertAssoc = db.prepare("INSERT INTO assoc VALUES(?,?,?,?)");
let assocRows = 0;
for (const [word, list] of scored) {
  list.sort((a, b) => b[1] - a[1]);
  for (const [symbol, score, together] of list.slice(0, TOP_ASSOC)) {
    insertAssoc.run(word, symbol, Math.round(score * 100) / 100, together);
    assocRows++;
  }
}

const setMeta = db.prepare("INSERT INTO meta VALUES(?,?)");
setMeta.run("built", new Date().toISOString());
setMeta.run("stats", JSON.stringify({ ...stats, reference: reference.length, catalog: catalog.size, idioms: kept.length, assoc: assocRows }));
db.exec("COMMIT");
db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES('optimize'); INSERT INTO ref_fts(ref_fts) VALUES('optimize');");
db.close();
for (let attempt = 0; ; attempt++) {
  try {
    if (existsSync(DB_FILE)) rmSync(DB_FILE);
    renameSync(TEMP, DB_FILE);
    break;
  } catch (e) {
    if (attempt >= 20) throw e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log({ ...stats, idioms: kept.length, assoc: assocRows }, `${((Date.now() - started) / 1000).toFixed(0)} с`);
