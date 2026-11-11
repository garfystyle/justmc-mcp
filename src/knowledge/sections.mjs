import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GUIDE } from "../paths.mjs";
import { tokens } from "./stem.mjs";

const HEADING = 4;
const K1 = 1.4;
const B = 0.6;

function split(topic, text) {
  const out = [];
  const title = text.match(/^#\s+(.+)/m)?.[1] ?? topic;
  let heading = title;
  let lines = [];
  let fenced = false;
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) out.push({ topic, title, heading, body });
    lines = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced && line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      flush();
      heading = m[2].trim();
      continue;
    }
    lines.push(line);
  }
  flush();
  return out;
}

export function loadSections() {
  if (!existsSync(GUIDE)) return { docs: [], df: new Map(), average: 1 };
  const docs = [];
  for (const file of readdirSync(GUIDE).filter((f) => f.endsWith(".md")).sort()) {
    docs.push(...split(file.slice(0, -3), readFileSync(join(GUIDE, file), "utf8")));
  }
  const df = new Map();
  let total = 0;
  for (const d of docs) {
    const counts = new Map();
    const add = (t, w) => counts.set(t, (counts.get(t) ?? 0) + w);
    for (const t of tokens(`${d.title} ${d.heading}`)) add(t, HEADING);
    for (const t of tokens(d.body)) add(t, 1);
    d.counts = counts;
    d.length = [...counts.values()].reduce((a, b) => a + b, 0);
    total += d.length;
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { docs, df, average: total / Math.max(docs.length, 1) };
}

export function searchSections({ docs, df, average }, query, limit = 4) {
  const words = [...new Set(tokens(query))];
  const n = docs.length;
  const scored = [];
  for (const d of docs) {
    let score = 0;
    for (const w of words) {
      const tf = d.counts.get(w);
      if (!tf) continue;
      const idf = Math.log(1 + (n - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / average));
    }
    if (score > 0) scored.push({ ...d, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
