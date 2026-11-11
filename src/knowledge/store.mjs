import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { DB_FILE, GUIDE, RAW } from "../paths.mjs";
import { matchQuery, tokens } from "./stem.mjs";
import { loadSections, searchSections } from "./sections.mjs";

const TITLE_WEIGHT = 6;
const POPULARITY_WEIGHT = 0.35;

const SYNONYMS = {
  кулдаун: ["перезарядка", "задержка", "cooldown"],
  перезарядк: ["кулдаун", "cooldown"],
  гуи: ["меню", "инвентар", "gui", "menu"],
  меню: ["инвентар", "gui", "menu"],
  топ: ["лидер", "рейтинг", "сортир"],
  таймер: ["отсчет", "wait", "timer"],
  деньг: ["монет", "баланс", "валют", "coin"],
  монет: ["деньг", "баланс", "coin"],
  дух: ["призрак"],
  скорборд: ["scoreboard", "таблиц", "sidebar"],
  таблиц: ["scoreboard", "sidebar"],
  голограмм: ["hologram", "text_display", "display", "визуализатор"],
  визуализатор: ["display", "голограмм", "spawn_text_display", "spawn_item_display", "spawn_block_display"],
  дисплей: ["display", "визуализатор"],
  нпс: ["npc", "житель", "villager"],
  рейкаст: ["raycast", "луч", "ray"],
  луч: ["raycast", "ray"],
  сохранен: ["save", "сохран"],
  телепорт: ["teleport", "tp"],
  анимац: ["interpolation", "интерполяц", "плавн"],
  плавн: ["interpolation", "интерполяц", "teleport_duration"],
  модел: ["display", "визуализатор", "block_display"],
  поворот: ["rotation", "вращ"],
  вращ: ["rotation", "поворот"],
  размер: ["scale", "масштаб"],
  масштаб: ["scale", "размер"],
  постав: ["установ", "set"],
  установ: ["постав", "set"],
  показ: ["отобраз", "отправ", "display", "show", "send"],
  отобраз: ["показ", "display"],
  отправ: ["показ", "send"],
  убр: ["удал", "remove", "clear"],
  удал: ["убр", "remove", "clear"],
  убер: ["удал", "remove", "clear"],
  забр: ["удал", "remove"],
  снят: ["удал", "сброс", "remove", "reset"],
  сброс: ["удал", "reset", "remove"],
  дат: ["выда", "give"],
  выда: ["give"],
  толк: ["запуст", "launch", "velocity"],
  подброс: ["запуст", "launch"],
  кин: ["запуст", "launch"],
  брос: ["запуст", "launch"],
  вылеч: ["исцел", "heal"],
  лечен: ["исцел", "heal"],
  умер: ["смерт", "death"],
  умир: ["смерт", "death"],
  смерт: ["death"],
  убит: ["смерт", "kill", "death"],
  подожд: ["wait", "ждат"],
  ждат: ["wait"],
  пауз: ["wait"],
  присел: ["sneak", "крад"],
  присед: ["sneak", "крад"],
  шифт: ["sneak", "крад"],
  разб: ["раздел", "split"],
  раздел: ["split"],
  тайтл: ["title"],
  экшн: ["action_bar", "action"],
  экшенбар: ["action_bar", "action"],
  хотбар: ["action_bar", "hotbar"],
  боссбар: ["boss_bar", "boss"],
  полос: ["boss_bar", "boss"],
  зашел: ["join", "вход"],
  вошел: ["join", "вход"],
  вышел: ["quit", "выход"],
  кликнул: ["click", "клика"],
  нажал: ["click", "клика"],
  быстр: ["скорост", "speed"],
  скорост: ["speed", "velocity"],
  заспавн: ["spawn", "созда"],
  спавн: ["spawn", "созда"],
  созда: ["spawn", "create"],
  сломат: ["break"],
  ломат: ["break"],
};

const synonyms = (word) =>
  Object.entries(SYNONYMS).flatMap(([key, list]) => (word.startsWith(key) || key.startsWith(word) ? list : []));

const RUSSIAN = /^[а-я]+$/;
const ROOT_LETTERS = 4;
const root = (word) => (RUSSIAN.test(word) && word.length > ROOT_LETTERS ? [word.slice(0, ROOT_LETTERS)] : []);

function expand(text) {
  const words = tokens(text);
  return matchQuery(text, [...words.flatMap(synonyms), ...words.flatMap(root)]);
}

const wordHits = (word, hay) =>
  hay.some((h) => h.startsWith(word) || (h.length >= ROOT_LETTERS && word.startsWith(h)) || (RUSSIAN.test(word) && word.length > ROOT_LETTERS && h.startsWith(word.slice(0, ROOT_LETTERS))));

function titleCoverage(wanted, row) {
  const hay = tokens(`${row.name} ${row.title}`);
  return wanted.filter((word) => [word, ...synonyms(word)].flatMap(tokens).some((w) => wordHits(w, hay))).length / wanted.length;
}

const shape = (line) =>
  line
    .trim()
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`[^`]*`/g, "`v`")
    .replace(/\b\d+(?:\.\d+)?\b/g, "0")
    .replace(/\b[a-zа-яё_][\wа-яё]*\b(?=\s*=)/gi, "v");

export class Knowledge {
  constructor() {
    this.db = existsSync(DB_FILE) ? new Database(DB_FILE, { readonly: true, fileMustExist: true }) : null;
    this.statements = new Map();
    this.sections = loadSections();
  }

  get ready() {
    return this.db !== null;
  }

  q(sql) {
    if (!this.db) throw new Error("база знаний не собрана: npm run learn");
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  stats() {
    const row = this.q("SELECT value FROM meta WHERE key='stats'").get();
    const built = this.q("SELECT value FROM meta WHERE key='built'").get();
    return { ...JSON.parse(row?.value ?? "{}"), built: built?.value };
  }

  assoc(text, limit = 40) {
    const scores = new Map();
    for (const word of new Set(tokens(text))) {
      for (const row of this.q("SELECT symbol, score FROM assoc WHERE word = ?").all(word)) {
        scores.set(row.symbol, (scores.get(row.symbol) ?? 0) + row.score);
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  lookup(query, { kinds, limit = 12 } = {}) {
    const allowed = (r) => !kinds?.length || kinds.includes(r.kind);
    const exact = this.q("SELECT * FROM ref WHERE name = ? OR title = ? COLLATE NOCASE ORDER BY uses DESC").all(query, query);
    const seen = new Set(exact.map((r) => r.id));
    const out = exact.filter(allowed);
    const scores = new Map();
    const match = expand(query);
    if (match) {
      const rows = this.q(
        `SELECT ref.*, bm25(ref_fts, 10.0, 8.0, 3.0, 0.6) AS rank FROM ref_fts JOIN ref ON ref.id = ref_fts.rowid
         WHERE ref_fts MATCH ? ORDER BY rank`,
      ).all(match);
      for (const r of rows) {
        if (seen.has(r.id) || !allowed(r)) continue;
        scores.set(r.id, { row: r, score: -r.rank * (1 + 0.1 * Math.log10(r.uses + 1)) });
      }
    }
    const bySymbol = this.q("SELECT * FROM ref WHERE name = ? ORDER BY uses DESC LIMIT 1");
    for (const [symbol, score] of this.assoc(query)) {
      const r = bySymbol.get(symbol);
      if (!r || seen.has(r.id) || !allowed(r)) continue;
      const entry = scores.get(r.id) ?? { row: r, score: 0 };
      entry.score += score * 0.35;
      scores.set(r.id, entry);
    }
    const wanted = [...new Set(tokens(query))];
    for (const entry of scores.values()) {
      const covered = wanted.length ? titleCoverage(wanted, entry.row) : 0;
      entry.score *= 1 + TITLE_WEIGHT * covered * covered + POPULARITY_WEIGHT * Math.log10(entry.row.modules + 1);
    }
    out.push(...[...scores.values()].sort((a, b) => b.score - a.score).map((e) => e.row));
    return out.slice(0, limit);
  }

  entries(name) {
    const rows = this.q("SELECT * FROM ref WHERE name = ?").all(name);
    if (rows.length) return rows;
    if (name.startsWith("%")) return this.q("SELECT * FROM ref WHERE name IN (?, ?)").all(`${name}()`, `${name}%`);
    const wanted = name.replace(/^when\s+/, "").replace(/\(.*$/, "").trim();
    return this.q("SELECT * FROM ref WHERE name = ? OR name LIKE ? OR name = ? ORDER BY uses DESC LIMIT 6").all(wanted, `%.${wanted}`, `value.${wanted}`);
  }

  learned(symbol) {
    const fill = this.q("SELECT arg, modules FROM arg_fill WHERE symbol = ? ORDER BY modules DESC").all(symbol);
    const values = this.q("SELECT arg, value, modules FROM arg_value WHERE symbol = ? ORDER BY modules DESC").all(symbol);
    const next = this.q("SELECT next, modules FROM next_step WHERE symbol = ? ORDER BY modules DESC").all(symbol);
    const idioms = this.q(
      `SELECT idiom.steps, idiom.modules FROM idiom_symbol JOIN idiom ON idiom.id = idiom_symbol.idiom
       WHERE idiom_symbol.symbol = ? ORDER BY idiom.modules DESC, idiom.length DESC LIMIT 4`,
    ).all(symbol);
    return { fill, values, next, idioms };
  }

  usage(symbol, { limit = 6 } = {}) {
    const rows = this.q(
      `SELECT chunk.id, chunk.kind, chunk.name, chunk.code, chunk.length, chunk.weight, module.title, module.id AS module
       FROM usage JOIN chunk ON chunk.id = usage.chunk JOIN module ON module.id = chunk.module
       WHERE usage.symbol = ? ORDER BY chunk.weight DESC LIMIT 400`,
    ).all(symbol);
    const bare = symbol.replace(/…\)$/, "");
    const lines = [];
    const shapes = new Set();
    for (const row of rows) {
      for (const line of row.code.split("\n")) {
        if (!line.includes(bare) || line.length > 200 || line.includes('raw("')) continue;
        const s = shape(line);
        if (shapes.has(s)) continue;
        shapes.add(s);
        lines.push({ code: line.trim(), module: row.title });
        break;
      }
      if (lines.length >= limit) break;
    }
    const context = rows
      .filter((r) => r.length >= 3 && r.length <= 24 && !r.code.includes('raw("'))
      .sort((a, b) => b.weight - a.weight || a.length - b.length)[0];
    return { lines, context };
  }

  companions(event, limit = 14) {
    return this.q("SELECT symbol, modules FROM pair WHERE event = ? ORDER BY modules DESC LIMIT ?").all(event, limit);
  }

  searchChunks(query, { tag, symbol, kind, limit = 6, cleanOnly = false } = {}) {
    const match = expand(query ?? "");
    const related = new Map(query ? this.assoc(query, 25) : []);
    let rows;
    if (match) {
      rows = this.q(
        `SELECT chunk.*, bm25(chunk_fts, 8.0, 3.0, 1.0) AS rank, module.title, module.category, module.installs, module.clean
         FROM chunk_fts JOIN chunk ON chunk.id = chunk_fts.rowid JOIN module ON module.id = chunk.module
         WHERE chunk_fts MATCH ? ORDER BY rank LIMIT 500`,
      ).all(match);
    } else if (symbol) {
      rows = this.q(
        `SELECT chunk.*, -1.0 AS rank, module.title, module.category, module.installs, module.clean
         FROM usage JOIN chunk ON chunk.id = usage.chunk JOIN module ON module.id = chunk.module
         WHERE usage.symbol = ? ORDER BY chunk.weight DESC LIMIT 500`,
      ).all(symbol);
    } else if (tag) {
      rows = this.q(
        `SELECT chunk.*, -1.0 AS rank, module.title, module.category, module.installs, module.clean
         FROM chunk JOIN module ON module.id = chunk.module
         WHERE (' ' || chunk.tags || ' ') LIKE ? ORDER BY chunk.weight DESC LIMIT 500`,
      ).all(`% ${tag} %`);
    } else {
      throw new Error("нужен query, symbol или tag");
    }
    const withSymbol = symbol && match ? new Set(this.q("SELECT chunk FROM usage WHERE symbol = ?").all(symbol).map((r) => r.chunk)) : null;
    const symbolsOf = this.q("SELECT symbol FROM usage WHERE chunk = ?");
    const seen = new Set();
    const out = [];
    const scored = rows
      .filter((r) => (!tag || ` ${r.tags} `.includes(` ${tag} `)) && (!kind || r.kind === kind) && (!cleanOnly || r.clean) && (!withSymbol || withSymbol.has(r.id)))
      .map((r) => {
        let bonus = 0;
        if (related.size) for (const { symbol: s } of symbolsOf.all(r.id)) bonus += (related.get(s) ?? 0) * 0.05;
        return { ...r, score: (-r.rank * (1 + 0.12 * Math.max(r.weight, 0)) + bonus) / Math.log2(r.length + 3) };
      })
      .sort((a, b) => b.score - a.score);
    for (const r of scored) {
      if (seen.has(r.shape)) continue;
      seen.add(r.shape);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  module(wanted) {
    const id = String(wanted).trim();
    return (
      this.q("SELECT * FROM module WHERE id = ?").get(id) ??
      this.q("SELECT * FROM module WHERE name = ? COLLATE NOCASE ORDER BY installs DESC").get(id) ??
      this.q("SELECT * FROM module WHERE title = ? COLLATE NOCASE ORDER BY installs DESC").get(id) ??
      this.q("SELECT * FROM module WHERE title LIKE ? ORDER BY installs DESC").get(`%${id}%`) ??
      null
    );
  }

  modules({ tag, category, query, limit = 20 } = {}) {
    const rows = this.q("SELECT id, name, title, about, category, installs, stars, blocks, tags FROM module ORDER BY installs DESC").all();
    const words = query ? tokens(query) : [];
    return rows
      .filter((m) => (!tag || ` ${m.tags} `.includes(` ${tag} `)) && (!category || m.category === category))
      .filter((m) => {
        if (!words.length) return true;
        const hay = new Set(tokens(`${m.title} ${m.about} ${m.tags}`));
        return words.some((w) => hay.has(w));
      })
      .slice(0, limit);
  }

  chunks(module) {
    return this.q("SELECT kind, name, line, length, doc FROM chunk WHERE module = ? ORDER BY line").all(module);
  }

  importable(wanted, connect) {
    const m = this.ready ? this.module(wanted) : null;
    if (!m) return JSON.stringify({ error: `нет модуля «${wanted}» в локальной базе`, hint: "найди его через examples" });
    const entry = JSON.parse(m.entry);
    const file = join(RAW, `${m.id}.json.gz`);
    const handlers = existsSync(file) ? JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")).handlers : [];
    return JSON.stringify({ wanted, id: m.id, name: m.name, title: m.title, updated: m.updated, entry, handlers, connect });
  }

  guides() {
    if (!existsSync(GUIDE)) return [];
    return readdirSync(GUIDE)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => {
        const text = readFileSync(join(GUIDE, f), "utf8");
        return { topic: f.slice(0, -3), title: text.match(/^#\s+(.+)/m)?.[1] ?? f, text };
      });
  }

  guideSearch(query, limit = 4) {
    return searchSections(this.sections, query, limit);
  }
}
