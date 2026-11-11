import { rawFormat, rawSymbols, rawVariables } from "./core.mjs";

const LOOP_COUNTERS = new Set(["i", "j", "k"]);
const COORDINATES = new Set(["x", "y", "z"]);
const CLEAR_SHORT_WORDS = new Set([
  "id", "hp", "xp", "ui", "ai", "tp", "to", "of", "in", "on", "at", "by", "up", "is", "no", "or", "pi", "mm", "ms", "my", "go",
  "as", "if", "do", "be", "so", "an", "ok", "we", "us",
  "я", "ты", "он", "мы", "вы", "на", "по", "из", "от", "до", "за", "не", "ид",
]);
const CLEAR_ACRONYMS = new Set(["npc", "pvp", "pve", "tnt", "tps", "fps", "rgb", "hsv", "url", "gui", "hud", "xyz", "sql", "ttl", "uuid"]);
const VOWELS = /[aeiouyаеёиоуыэюя]/i;
const LANGUAGE_WORDS = new Set(["true", "false", "value", "self"]);
const SCOPES_WITH_NAMES = new Set(["const", "game", "save", "line", "local"]);
const ORDINARY_NUMBERS = new Set(["10", "15", "20", "60", "100", "0.5", "1.5", "2.5", "255"]);

const MAX_HANDLER_LINES = 40;
const MAX_DEPTH = 4;
const MAX_FILE_LINES = 400;
const MAX_LINE_LENGTH = 120;
const MIN_STATE_COMPARISONS = 3;
const MIN_REPEATED_NUMBER = 5;
const MIN_REPEATED_STRING = 4;
const DUPLICATE_WINDOW = 4;
const DUPLICATE_MIN_LENGTH = 12;
const DATA_LINE_LENGTH = 2000;
const DATA_FILE_LENGTH = 200000;
const LISTED = 12;
export const FORMAT_RULE = "формат";

const IDENTIFIER = "[\\p{L}_][\\p{L}\\p{N}_]*";
const STATE_COMPARISON = new RegExp(`(${IDENTIFIER})\\s*(?:==|!=)\\s*(-?\\d+(?:\\.\\d+)?)(?![\\p{L}\\p{N}_.])`, "gu");
const NUMBER_LITERAL = /(?<![\p{L}\p{N}_.])(?:\d+\.\d+|\d{2,})(?![\p{L}\p{N}_.])/gu;
const COUNTER_LOOP = new RegExp(`\\bwhile\\s+(${IDENTIFIER})\\s*<=?\\s*[^{\\n]+\\{`, "gu");
const INDEX_CALL = /\bget_list_value\s*\(\s*[^,()]+,\s*[^,()]+\)/g;
const PLAIN_STRING = /^[\p{L}\p{N}_.:#-]{1,24}$/u;

export function blankStringsAndComments(text) {
  const out = text.split("");
  const strings = [];
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < text.length;) {
    const pair = text.slice(i, i + 2);
    const end = pair === "//" ? text.indexOf("\n", i) : pair === "/*" ? text.indexOf("*/", i) + 2 : -1;
    if (pair === "//" || pair === "/*") {
      const stop = end <= 1 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (text[i] === '"' || text[i] === "`") {
      let stop = i + 1;
      while (stop < text.length && text[stop] !== text[i] && text[stop] !== "\n") stop += text[stop] === "\\" ? 2 : 1;
      if (text[i] === '"') strings.push({ at: i, value: text.slice(i + 1, stop) });
      blank(i, stop + 1);
      i = stop + 1;
    } else {
      i++;
    }
  }
  return { code: out.join(""), strings };
}

const lineStarts = (text) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
};

function lineFinder(text) {
  const starts = lineStarts(text);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

const listed = (items) => items.slice(0, LISTED).join(", ") + (items.length > LISTED ? ` и ещё ${items.length - LISTED}` : "");

export function isCrypticName(name) {
  if (LANGUAGE_WORDS.has(name) || /\s|%/.test(name)) return false;
  const words = name.toLowerCase().split("_").filter(Boolean).map((word) => word.replace(/\d+$/, ""));
  if (words.length === 1 && (LOOP_COUNTERS.has(words[0]) || COORDINATES.has(words[0]))) return false;
  return words.some((word) => {
    if (!word || COORDINATES.has(word) || CLEAR_SHORT_WORDS.has(word) || CLEAR_ACRONYMS.has(word)) return false;
    return word.length <= 2 || (word.length <= 5 && !VOWELS.test(word));
  });
}

function crypticNames(text, lineOf) {
  const first = new Map();
  for (const { start, end, scope } of JSON.parse(rawVariables(text))) {
    if (!SCOPES_WITH_NAMES.has(scope)) continue;
    const name = text.slice(start, end);
    if (!first.has(name) && isCrypticName(name)) first.set(name, lineOf(start));
  }
  for (const { name, nameStart, kind } of JSON.parse(rawSymbols(text))) {
    if (kind !== "event" && !first.has(name) && isCrypticName(name)) first.set(name, lineOf(nameStart));
  }
  if (!first.size) return [];
  const names = [...first].map(([name, line]) => `\`${name}\` (${line})`);
  return [{ rule: "имена", text: `имена ничего не говорят: ${listed(names)}. Пиши словом: boss_health, clip_name, frame_delay` }];
}

function numberedStates(code) {
  const states = new Map();
  for (const [, name, number] of code.matchAll(STATE_COMPARISON)) {
    if (!states.has(name)) states.set(name, []);
    states.get(name).push(number);
  }
  const unnamed = [...states].filter(([, numbers]) => numbers.length >= MIN_STATE_COMPARISONS && numbers.some((n) => n !== "0"));
  return unnamed.map(([name, numbers]) => ({
    rule: "состояния",
    text: `\`${name}\` сравнивается с числами ${[...new Set(numbers)].join(", ")} в ${numbers.length} местах: дай значениям имена, const MODE_FIGHT = 1`,
  }));
}

function repeated(values, minimum) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count >= minimum).sort((a, b) => b[1] - a[1]);
}

function constantRanges(code) {
  const ranges = [];
  for (const match of code.matchAll(/^[ \t]*const\b/gm)) {
    let depth = 0;
    let end = match.index;
    for (; end < code.length; end++) {
      if ("([{".includes(code[end])) depth++;
      else if (")]}".includes(code[end])) depth--;
      else if (code[end] === "\n" && depth <= 0) break;
    }
    ranges.push([match.index, end]);
  }
  return ranges;
}

const outsideRanges = (ranges) => (at) => !ranges.some(([from, to]) => at >= from && at < to);

function repeatedLiterals(code, strings) {
  const counted = outsideRanges(constantRanges(code));
  const numbers = [...code.matchAll(NUMBER_LITERAL)]
    .filter((match) => counted(match.index) && !ORDINARY_NUMBERS.has(match[0]))
    .map((match) => match[0]);
  const words = strings.filter(({ at, value }) => counted(at) && PLAIN_STRING.test(value)).map(({ value }) => `"${value}"`);
  const repeats = [...repeated(numbers, MIN_REPEATED_NUMBER), ...repeated(words, MIN_REPEATED_STRING)];
  if (!repeats.length) return [];
  return [{ rule: "литералы", text: `значения повторяются: ${listed(repeats.map(([value, count]) => `${value} ×${count}`))}. Вынеси в const с именем` }];
}

function longHandlers(text, lineOf) {
  const long = JSON.parse(rawSymbols(text))
    .map(({ name, start, end }) => ({ name, length: lineOf(end) - lineOf(start) + 1 }))
    .filter(({ length }) => length > MAX_HANDLER_LINES)
    .sort((a, b) => b.length - a.length);
  if (!long.length) return [];
  return [{ rule: "размер", text: `длинные обработчики: ${listed(long.map(({ name, length }) => `${name} (${length} строк)`))}. Дели на функции до ${MAX_HANDLER_LINES} строк` }];
}

function deepNesting(code, lineOf) {
  const lines = new Set();
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    if (code[i] === "{" && depth > MAX_DEPTH) lines.add(lineOf(i));
  }
  if (!lines.size) return [];
  return [{ rule: "вложенность", text: `глубже ${MAX_DEPTH} уровней: строки ${listed([...lines].map(String))}. Выходи раньше через return и continue или выноси тело в функцию` }];
}

const closingBrace = (code, open) => {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  return -1;
};

function counterLoops(code, lineOf) {
  const lines = [];
  for (const match of code.matchAll(COUNTER_LOOP)) {
    const open = match.index + match[0].length - 1;
    const body = code.slice(open + 1, closingBrace(code, open)).trimEnd();
    if (body.endsWith(`${match[1]} += 1`)) lines.push(lineOf(match.index));
  }
  if (!lines.length) return [];
  return [{ rule: "циклы", text: `счётчик руками: строки ${listed(lines.map(String))}. Пиши for i in a..b, конец входит` }];
}

function indexCalls(code, lineOf) {
  const lines = [...code.matchAll(INDEX_CALL)].map((match) => lineOf(match.index));
  if (!lines.length) return [];
  return [{ rule: "индекс", text: `get_list_value вместо индекса: строки ${listed(lines.map(String))}. Пиши list[i], вид скажи объявлением: game delays: list` }];
}

function duplicatedBlocks(lines, code) {
  const keys = lines.map((line) => line.trim().replace(/\d+(?:\.\d+)?/g, "#"));
  const counted = outsideRanges(constantRanges(code));
  const starts = lineStarts(code);
  const usable = (i) => keys[i].length >= DUPLICATE_MIN_LENGTH && counted(starts[i]);
  const seen = new Map();
  const pairs = [];
  for (let i = 0; i + DUPLICATE_WINDOW <= keys.length; i++) {
    if (![...Array(DUPLICATE_WINDOW).keys()].every((shift) => usable(i + shift))) continue;
    const key = keys.slice(i, i + DUPLICATE_WINDOW).join("\n");
    const earlier = seen.get(key);
    if (earlier === undefined) {
      seen.set(key, i);
    } else if (i - earlier >= DUPLICATE_WINDOW) {
      pairs.push(`${earlier + 1} и ${i + 1}`);
      i += DUPLICATE_WINDOW - 1;
    }
  }
  if (!pairs.length) return [];
  return [{ rule: "повтор", text: `одинаковые куски со строк ${listed(pairs)}. Вынеси в func` }];
}

function fileShape(text, lines) {
  const remarks = [];
  if (lines.length > MAX_FILE_LINES) {
    remarks.push({ rule: "файл", text: `${lines.length} строк в одном файле. Раздели на файлы по смыслу и залей папку проекта` });
  }
  const long = lines.filter((line) => line.length > MAX_LINE_LENGTH).length;
  if (long) remarks.push({ rule: "ширина", text: `строк длиннее ${MAX_LINE_LENGTH} символов: ${long}. Разбей вызов или вынеси значение в const` });
  const formatted = JSON.parse(rawFormat(text));
  if (formatted.ok && formatted.text.replace(/\r\n/g, "\n").trimEnd() !== text.replace(/\r\n/g, "\n").trimEnd()) {
    remarks.push({ rule: FORMAT_RULE, text: "файл не в стиле Xero: check с format=true приведёт его" });
  }
  return remarks;
}

export const isGeneratedData = (text) => text.length > DATA_FILE_LENGTH || text.split("\n").some((line) => line.length > DATA_LINE_LENGTH);

export function reviewFile(text) {
  if (isGeneratedData(text)) return [];
  const clean = text.replace(/\r\n/g, "\n");
  const lines = clean.split("\n");
  const lineOf = lineFinder(clean);
  const { code, strings } = blankStringsAndComments(clean);
  return [
    ...crypticNames(clean, lineOf),
    ...numberedStates(code),
    ...repeatedLiterals(code, strings),
    ...longHandlers(clean, lineOf),
    ...deepNesting(code, lineOf),
    ...counterLoops(code, lineOf),
    ...indexCalls(code, lineOf),
    ...duplicatedBlocks(lines, code),
    ...fileShape(clean, lines),
  ];
}

export function reviewProject(texts) {
  return [...texts].filter(([file]) => !String(file).endsWith("/") && !String(file).endsWith(".debug.xero")).flatMap(([file, text]) => {
    const name = String(file).split("/").pop();
    return reviewFile(text).map((remark) => ({ ...remark, file: name }));
  });
}
