import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

setGlobalDispatcher(new EnvHttpProxyAgent());

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const RAW = join(DATA, "raw");
const CATALOG = join(DATA, "catalog.json");
const SKIPPED = join(DATA, "skipped.json");
const LOG = join(DATA, "crawl.log");
const BASE = "https://api.creative.justmc.io/public/creative/modules";
const PAGE = 100;
const RESERVE = 2;
const FRESH_MS = 24 * 3600 * 1000;

mkdirSync(RAW, { recursive: true });

const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(LOG, text + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let remaining = 20;
let resetAt = 0;

async function get(url) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    if (remaining <= RESERVE && resetAt > now) await sleep(resetAt - now + 1500);
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": "justmc-mcp" }, signal: AbortSignal.timeout(60000) });
    } catch (e) {
      log(`сеть: ${e.cause?.message ?? e.message}, пауза`);
      await sleep(10000 * (attempt + 1));
      continue;
    }
    const left = Number(res.headers.get("x-ratelimit-remaining"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(left) && res.headers.has("x-ratelimit-remaining")) remaining = left;
    if (Number.isFinite(reset) && reset > 0) resetAt = reset * 1000;
    if (Date.now() > resetAt) remaining = Math.max(remaining, RESERVE + 1);
    if (res.status === 429) {
      await res.arrayBuffer().catch(() => {});
      remaining = 0;
      if (resetAt <= Date.now()) resetAt = Date.now() + 61000;
      log(`429, жду до ${new Date(resetAt).toISOString()}`);
      continue;
    }
    if (res.status >= 500) {
      await res.arrayBuffer().catch(() => {});
      await sleep(15000 * (attempt + 1));
      continue;
    }
    return { status: res.status, body: res.status === 200 ? await res.text() : null };
  }
  throw new Error(`не вышло: ${url}`);
}

async function catalog() {
  if (existsSync(CATALOG)) {
    const saved = JSON.parse(readFileSync(CATALOG, "utf8"));
    if (Date.now() - saved.at < FRESH_MS) return saved.modules;
  }
  const seen = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const { status, body } = await get(`${BASE}?offset=${offset}&limit=${PAGE}`);
    if (status !== 200) throw new Error(`каталог ответил ${status}`);
    const page = JSON.parse(body);
    let fresh = 0;
    for (const m of page) if (!seen.has(m.id)) { seen.set(m.id, m); fresh++; }
    log(`каталог: смещение ${offset}, пришло ${page.length}, новых ${fresh}, всего ${seen.size}`);
    if (page.length < PAGE || fresh === 0) break;
  }
  const modules = [...seen.values()];
  writeFileSync(CATALOG, JSON.stringify({ at: Date.now(), modules }));
  return modules;
}

const modules = await catalog();
const skipped = existsSync(SKIPPED) ? JSON.parse(readFileSync(SKIPPED, "utf8")) : {};
const queue = modules
  .filter((m) => m.codeVisible !== false && !(m.price > 0))
  .sort((a, b) => (b.history ?? 0) - (a.history ?? 0) || (b.stars ?? 0) - (a.stars ?? 0));
log(`модулей ${modules.length}, открытых и бесплатных ${queue.length}`);

let done = 0;
let got = 0;
for (const m of queue) {
  const file = join(RAW, `${m.id}.json.gz`);
  done++;
  if (existsSync(file) || skipped[m.id]) continue;
  const { status, body } = await get(`${BASE}/${m.id}/code`);
  if (status === 200) {
    writeFileSync(file, gzipSync(body, { level: 9 }));
    got++;
    if (got % 20 === 0) log(`код: ${done}/${queue.length}, скачано за запуск ${got}`);
  } else {
    skipped[m.id] = status;
    writeFileSync(SKIPPED, JSON.stringify(skipped));
    log(`код ${m.id} «${m.name}»: ответ ${status}`);
  }
}
log(`готово: ${done}/${queue.length}, скачано за запуск ${got}`);
