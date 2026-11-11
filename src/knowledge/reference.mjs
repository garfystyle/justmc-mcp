import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE } from "../paths.mjs";

const ACTION_FILES = ["player", "entity", "world", "variable", "select", "repeat", "control", "controller"];

const cells = (line) =>
  line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

const clean = (text) => text.replaceAll("<br>", " ").replace(/\s+/g, " ").trim();
const unquote = (text) => text.replace(/^`|`$/g, "");

function actions(file) {
  const out = [];
  let section = "";
  let group = "";
  let entry = null;
  const flush = () => {
    if (!entry) return;
    const body = entry.lines.join("\n").trim();
    const head = body.match(/^\*\*(.+?)\*\*\s*(?:—\s*(.*))?/m);
    out.push({
      kind: section.startsWith("Если") ? "condition" : "action",
      name: entry.name,
      title: head?.[1] ?? "",
      section: [section, group].filter(Boolean).join(" / "),
      summary: clean(head?.[2] ?? ""),
      body,
    });
    entry = null;
  };
  for (const line of readFileSync(join(REFERENCE, "actions", `${file}.md`), "utf8").split(/\r?\n/)) {
    const h4 = line.match(/^#### `(.+)`/);
    if (h4) {
      flush();
      entry = { name: h4[1], lines: [] };
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      flush();
      if (line.startsWith("## ")) {
        section = line.slice(3).trim();
        group = "";
      } else if (line.startsWith("### ")) {
        group = line.slice(4).trim();
      }
      continue;
    }
    entry?.lines.push(line);
  }
  flush();
  return out;
}

function table(file, kind, read) {
  const out = [];
  let section = "";
  let group = "";
  let header = null;
  for (const line of readFileSync(join(REFERENCE, file), "utf8").split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      group = "";
    } else if (line.startsWith("### ")) {
      group = line.slice(4).trim();
    }
    if (!line.startsWith("|")) {
      header = null;
      continue;
    }
    const row = cells(line);
    if (row.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!header) {
      header = row;
      continue;
    }
    const entry = read(row, [section, group].filter(Boolean).join(" / "), header);
    if (entry) out.push({ kind: typeof kind === "function" ? kind(section) : kind, ...entry });
  }
  return out;
}

const SECTION_KIND = { Частицы: "particle", Зелья: "potion", Чары: "enchantment", Звуки: "sound" };

export function loadReference() {
  const out = [];
  for (const file of ACTION_FILES) out.push(...actions(file));
  out.push(
    ...table("events.md", "event", ([name, title, what, cancel], section) => ({
      name: unquote(name),
      title,
      section,
      summary: clean(what ?? ""),
      body: `**${title}** — ${clean(what ?? "")}${cancel === "✓" ? "\n\nОтменяемое: `cancel_event()`." : ""}\n\n\`\`\`kotlin\nwhen ${unquote(name)} {\n}\n\`\`\``,
    })),
  );
  out.push(
    ...table("values.md", "value", ([name, title, type, what], section) => ({
      name: unquote(name),
      title,
      section,
      summary: clean(what ?? ""),
      body: `**${title}** (${type}) — ${clean(what ?? "")}`,
    })),
  );
  out.push(
    ...table("placeholders.md", "placeholder", ([name, what], section) => ({
      name: unquote(name),
      title: "",
      section,
      summary: clean(what ?? ""),
      body: clean(what ?? ""),
    })),
  );
  out.push(
    ...table(
      "effects.md",
      (section) => SECTION_KIND[section] ?? "effect",
      (row, section) => {
        const name = unquote(row[0] ?? "");
        if (!name) return null;
        const rest = row.slice(1).filter(Boolean).map(clean);
        return { name, title: rest[0] ?? "", section, summary: rest.slice(1).join(" · "), body: rest.join(" — ") };
      },
    ),
  );
  out.push(
    ...table("components.md", "component", ([name, title, what, example], section) => ({
      name: unquote(name),
      title,
      section,
      summary: clean(what ?? ""),
      body: `**${title}** — ${clean(what ?? "")}\n\nПример: ${example ?? ""}`,
    })),
  );
  return out;
}
