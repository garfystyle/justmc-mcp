import { z } from "zod";
import { TAGS } from "../knowledge/tags.mjs";
import { clip, fence, register } from "./common.mjs";

const KINDS = ["action", "condition", "event", "value", "placeholder", "particle", "potion", "component"];
const SECTION_LIMIT = 2000;
const BRIEF_LINES = 3;
const CODE_LINES = 34;
const EXACT_NAME = /^[%\w.…()]+$/;
const BARE_ATTRIBUTES = "Имена без приставки (`max_health`, `movement_speed`, `armor` и другие, у которых есть вариант `generic_…`) собираются, но сервер останавливает строку: `Enum … value not found`. Бери `generic_…`.";

function argumentsLine(learned) {
  if (!learned.fill.length) return "";
  const top = learned.fill.slice(0, 6).map((f) => {
    const values = learned.values.filter((v) => v.arg === f.arg).slice(0, 4).map((v) => `${v.value} (${v.modules})`);
    return `- \`${f.arg}\`: задан в ${f.modules} модулях${values.length ? `; чаще: ${values.join(", ")}` : ""}`;
  });
  return `Как заполняют в модулях:\n${top.join("\n")}`;
}

function card(k, entry, full) {
  const parts = [`## \`${entry.name}\` · ${entry.kind} · ${entry.section}`, entry.body];
  if (entry.name.endsWith("set_attribute")) parts.push(BARE_ATTRIBUTES);
  if (entry.modules) parts.push(`В модулях: ${entry.modules} модулей, ${entry.uses} вызовов.`);
  else parts.push("В модулях не встречается: поведение смотри в руководстве или проверяй на сервере.");
  if (entry.kind === "event") {
    const list = k.companions(entry.name);
    if (list.length) parts.push(`Обычно внутри: ${list.map((c) => `\`${c.symbol}\``).join(", ")}.`);
  }
  if (!full) {
    const usable = entry.modules ? k.usage(entry.name).lines.filter((l) => (l.code.includes("(") ? l.code.endsWith(")") : true)).slice(0, BRIEF_LINES) : [];
    if (usable.length) parts.push(`Как пишут:\n${fence(usable.map((l) => l.code).join("\n"))}`);
    return parts.join("\n\n");
  }
  const learned = k.learned(entry.name);
  const args = argumentsLine(learned);
  if (args) parts.push(args);
  if (learned.next.length) parts.push(`Обычно дальше: ${learned.next.map((n) => `\`${n.next}\` (${n.modules})`).join(", ")}.`);
  if (learned.idioms.length) parts.push(`Связки:\n${learned.idioms.map((i) => `- ${i.steps} (${i.modules})`).join("\n")}`);
  if (entry.modules) {
    const { lines, context } = k.usage(entry.name);
    const usable = lines.filter((l) => (l.code.includes("(") ? l.code.endsWith(")") : true));
    if (usable.length) parts.push(`Как пишут:\n${fence(usable.map((l) => l.code).join("\n"))}`);
    if (context && entry.kind !== "placeholder") parts.push(`Целиком («${context.title}»):\n${fence(context.code)}`);
  }
  return parts.join("\n\n");
}

const trimCode = (code, limit = CODE_LINES) => {
  const lines = code.split("\n");
  return lines.length <= limit ? code : `${lines.slice(0, limit).join("\n")}\n… ещё ${lines.length - limit} строк`;
};

const excerpt = (text) => (text.length <= SECTION_LIMIT ? text : `${text.slice(0, SECTION_LIMIT)}\n…`);

const brief = (r) => `\`${r.name}\` [${r.kind}] ${r.title}${r.summary ? `: ${r.summary.slice(0, 120)}` : ""}${r.modules ? ` · в ${r.modules} модулях` : ""}`;

export function registerKnowledge(server, k) {
  register(server, "ask", {
    title: "С чего начать задачу",
    description: "Один вызов на задачу: нужные разделы руководства, имена действий и настоящий код модулей. Начинай с него, когда задача про то, что ещё не писал. query — что должно происходить в игре, своими словами.",
    schema: {
      query: z.string(),
      sections: z.number().int().min(0).max(6).optional(),
      names: z.number().int().min(0).max(20).optional(),
      code: z.number().int().min(0).max(5).optional(),
    },
    readOnly: true,
  }, ({ query, sections = 2, names = 8, code = 1 }) => {
    const parts = [];
    for (const s of k.guideSearch(query, sections)) {
      parts.push(`### ${s.title} › ${s.heading} (guide ${s.topic})\n${excerpt(s.body)}`);
    }
    const rows = names ? k.lookup(query, { limit: names }) : [];
    if (rows.length) parts.push(`### Имена\n${rows.map(brief).join("\n")}`);
    for (const c of code ? k.searchChunks(query, { limit: code }) : []) {
      parts.push(`### Код: «${c.title}» (${c.installs} установок), ${c.name}\n${fence(trimCode(c.code))}`);
    }
    return parts.length ? clip(parts.join("\n\n"), 16000) : "Ничего не нашлось: переформулируй другими словами или посмотри guide.";
  });

  register(server, "guide", {
    title: "Руководство",
    description: "Темы, выжатые из модулей и проверенные на сервере. Без topic: список тем. С topic: список разделов. section: часть заголовка, вернёт только эти разделы. full=true: тема целиком, она большая, бери её, только если нужна вся.",
    schema: { topic: z.string().optional(), section: z.string().optional(), full: z.boolean().optional() },
    readOnly: true,
  }, ({ topic, section, full }) => {
    const all = k.guides();
    if (!topic) return all.map((g) => `${g.topic}: ${g.title}`).join("\n");
    const wanted = topic.toLowerCase();
    const found = all.find((g) => g.topic === wanted) ?? all.find((g) => g.topic.includes(wanted) || g.title.toLowerCase().includes(wanted));
    if (!found) throw new Error(`нет темы «${topic}». Есть: ${all.map((g) => g.topic).join(", ")}`);
    if (full) return found.text;
    const parts = k.sections.docs.filter((s) => s.topic === found.topic);
    if (!section) return `${found.title}\n${parts.map((s) => `- ${s.heading} (${s.body.length})`).join("\n")}\nРаздел: guide(topic, section). Вся тема: full=true.`;
    const hits = parts.filter((s) => s.heading.toLowerCase().includes(section.toLowerCase()));
    if (!hits.length) throw new Error(`в теме ${found.topic} нет раздела «${section}». Есть: ${parts.map((s) => s.heading).join(" · ")}`);
    return hits.map((s) => `## ${s.heading}\n${s.body}`).join("\n\n");
  });

  register(server, "find", {
    title: "Найти имя",
    description: "Действия, условия, события, значения, плейсхолдеры, частицы, зелья, компоненты. Точное имя (set_display_scale, player_join, value.location): карточка с аргументами и примерами. full=true добавит типичные значения из модулей, что обычно идёт дальше и пример целиком. Несколько точных имён через запятую: карточки сразу. Слова («выдать предмет»): список имён.",
    schema: {
      query: z.string(),
      kinds: z.array(z.enum(KINDS)).optional(),
      limit: z.number().int().min(1).max(40).optional(),
      full: z.boolean().optional(),
    },
    readOnly: true,
  }, ({ query, kinds, limit, full }) => {
    const names = query.split(/[\s,]+/).filter(Boolean);
    const allowed = (e) => !kinds?.length || kinds.includes(e.kind);
    if (names.every((name) => EXACT_NAME.test(name) && k.entries(name).length)) {
      const exact = names.flatMap((name) => k.entries(name)).filter(allowed).slice(0, limit ?? Infinity);
      if (exact.length) return clip(exact.map((e) => card(k, e, full)).join("\n\n---\n\n"));
    }
    const rows = k.lookup(query, { kinds, limit: limit ?? 12 });
    return rows.length ? rows.map(brief).join("\n") : "Ничего не нашлось.";
  });

  register(server, "examples", {
    title: "Настоящий код модулей",
    description: `Код из 1075 модулей JustMC на Xero. query: что сделать словами. symbol: только с этим именем. tag: приём (${TAGS.join(", ")}). module: читать модуль целиком (handler: один обработчик, from: с какой строки). list=true: список модулей по query, tag, category.`,
    schema: {
      query: z.string().optional(),
      symbol: z.string().optional(),
      tag: z.string().optional(),
      module: z.string().optional().describe("id или имя модуля"),
      handler: z.string().optional(),
      from: z.number().int().min(1).optional(),
      list: z.boolean().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    },
    readOnly: true,
  }, ({ query, symbol, tag, module, handler, from, list, category, limit }) => {
    if (list) {
      const rows = k.modules({ query, tag, category, limit: limit ?? 20 });
      if (!rows.length) return "Ничего не нашлось.";
      return rows.map((m) => `«${m.title}» (${m.name}) · ${m.category} · ${m.installs} установок, ${m.stars} звёзд, ${m.blocks} блоков${m.tags ? ` · ${m.tags}` : ""}`).join("\n");
    }
    if (module) {
      const m = k.module(module);
      if (!m) throw new Error(`нет модуля «${module}»`);
      const all = m.xero.split("\n");
      const chunks = k.chunks(m.id);
      if (handler) {
        const hit = chunks.filter((c) => c.name === handler || c.name.toLowerCase().includes(handler.toLowerCase()));
        if (!hit.length) throw new Error(`нет «${handler}». Есть: ${chunks.slice(0, 40).map((c) => c.name).join(", ")}`);
        return clip(hit.slice(0, 4).map((c) => fence(all.slice(c.line - 1, c.line - 1 + c.length).join("\n"))).join("\n"));
      }
      const start = (from ?? 1) - 1;
      const toc = from ? "" : `\n${chunks.slice(0, 60).map((c) => `${c.line}: ${c.kind} ${c.name}`).join("\n")}\n`;
      const more = start + 200 < all.length ? `\n… дальше from=${start + 201}` : "";
      return clip(`«${m.title}» · ${m.installs} установок\n${m.about}${toc}\n${fence(all.slice(start, start + 200).join("\n"))}${more}`);
    }
    const rows = k.searchChunks(query, { symbol, tag, limit: limit ?? 5 });
    if (!rows.length) return "Ничего не нашлось.";
    return clip(rows.map((c) => `### «${c.title}» (${c.installs} установок): ${c.name}, модуль ${c.module}${c.doc ? `\n${c.doc}` : ""}\n${fence(trimCode(c.code, 45))}`).join("\n\n"));
  });
}
