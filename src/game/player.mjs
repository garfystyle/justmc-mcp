import { GameError, get, post } from "./agent.mjs";
import { REPLY, isLimitsReport, isServiceReport, isVariableList, isWorldStop, listedTotal, readableValue } from "./replies.mjs";

const COMMAND_GAP = 1600;
const JOB_POLL = 500;
const NEAR_ENOUGH = 1.5;
const CLICK_SETTLE = 250;
const CLOSE_SETTLE = 150;
const KEYS = new Set(["forward", "back", "left", "right", "jump", "sneak", "sprint", "use", "attack"]);
const CLICKS = new Set(["use", "attack", "drop", "swap_hands", "pick"]);

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("остановлено"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("остановлено"));
    }, { once: true });
  });

export const state = () => get("/state");
export const inventory = () => get("/inventory");
export const hud = () => get("/hud");
export const gui = ({ all = false } = {}) => get(`/gui?all=${all ? 1 : 0}`);
export const scene = (query = {}) => post("/scene", query);
export const block = ({ x, y, z }) => get(`/block?x=${Math.floor(x)}&y=${Math.floor(y)}&z=${Math.floor(z)}`);
export const region = (query = {}) => post("/region", query);
export const commands = (depth = 4) => get(`/commands?depth=${depth}`, 30000);
export const setHotbar = (slot) => post("/hotbar", { slot: Number(slot) });
export const releaseAll = () => post("/release");
export const respawn = () => post("/respawn");

let nextCommandAt = 0;

export async function commandGap(signal) {
  const now = Date.now();
  const slot = Math.max(now, nextCommandAt);
  nextCommandAt = slot + COMMAND_GAP;
  if (slot > now) await sleep(slot - now, signal);
}

export async function send(text, signal) {
  await commandGap(signal);
  await post("/say", { text });
}

const tidy = (text) => text.replace(/[​-‏⁠﻿]/g, "").replace(/\s+/g, " ").trim();
const ALERT = /[❌☠⚠✕]|ОШИБКА|ПРЕДУПРЕЖДЕНИЕ|из-за ошибки/;
const GLOBAL_CHAT = /^(?:\[!\]|\[⭐\]|⏵|⏴)|приглашает поиграть/;
const split = (text) => (ALERT.test(text) ? [text] : text.split("\n"));

export const events = ({ since = 0, types, limit = 2000 } = {}) =>
  get(`/events?since=${since}&limit=${limit}${types?.length ? `&types=${types.join(",")}` : ""}`);

export class Watch {
  static async start({ local = true } = {}) {
    const watch = new Watch();
    watch.local = local;
    watch.head = (await events({ limit: 1 })).head;
    watch.start = watch.head;
    return watch;
  }

  chat = [];
  all = [];
  mark = 0;
  marks = {};

  async poll() {
    const { head, events: fresh } = await events({ since: this.head, limit: 20000 });
    this.head = head;
    const lines = [];
    for (const e of fresh) {
      this.all.push(e);
      if (e.type !== "chat") continue;
      for (const part of split(e.text ?? "")) {
        const text = tidy(part);
        if (!text || (this.local && GLOBAL_CHAT.test(text))) continue;
        lines.push(text);
      }
    }
    this.chat.push(...lines);
    return lines;
  }

  find(type, test, from = 0) {
    for (let i = from; i < this.all.length; i++) {
      const e = this.all[i];
      if (e.type === type && test(e)) return i;
    }
    return -1;
  }

  summary() {
    const sounds = new Map();
    const particles = new Map();
    const blocks = new Map();
    const spawned = new Set();
    const out = {};
    const take = (key, value) => {
      if (value) (out[key] ??= []).push(value);
    };
    for (const e of this.all) {
      if (e.type === "health") {
        const before = out.health?.end ?? Infinity;
        out.health = { min: Math.min(out.health?.min ?? Infinity, e.health), end: e.health };
        if (e.health <= 0 && before > 0) out.deaths = (out.deaths ?? 0) + 1;
      }
      if (e.type === "sound") sounds.set(e.id, (sounds.get(e.id) ?? 0) + 1);
      else if (e.type === "particle") particles.set(e.id, (particles.get(e.id) ?? 0) + (e.count ?? 1));
      else if (e.type === "block") blocks.set(e.block, (blocks.get(e.block) ?? 0) + 1);
      else if (e.type === "title" || e.type === "subtitle" || e.type === "actionbar") take(e.type, e.text);
      else if (e.type === "bossbar" && e.text) take("bossbar", e.text);
      else if (e.type === "screen") take("screens", e.title);
      else if (e.type === "effect") take("effects", e.id.replace("minecraft:", ""));
      else if (e.type === "entity_add" && !spawned.has(e.uuid)) {
        spawned.add(e.uuid);
        out.spawned = { ...(out.spawned ?? {}), [e.entity]: (out.spawned?.[e.entity] ?? 0) + 1 };
      }
      else if (e.type === "teleport") out.teleports = (out.teleports ?? 0) + 1;
      else if (e.type === "explosion") out.explosions = (out.explosions ?? 0) + 1;
    }
    const top = (map, n = 12) => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));
    if (sounds.size) out.sounds = top(sounds);
    if (particles.size) out.particles = top(particles);
    if (blocks.size) out.blocks = top(blocks);
    for (const key of ["title", "subtitle", "actionbar", "bossbar", "screens", "effects"]) {
      if (out[key]) out[key] = latestOfEachShape(out[key]).slice(-SEEN_LINES);
    }
    return out;
  }
}

const SINGLE_VALUE = /^\{type: (\w+), '([\s\S]*)'\}\s*$/;
const INNER_VALUE = /\{type: (\w+), '((?:[^']|'(?!\}))*)'\}/g;
const REPLY_WAIT = 4000;
const REPLY_TRIES = 3;
const LIST_PAGES = 5;
const SEEN_LINES = 10;
const NEWS_WINDOW = 8000;

const latestOfEachShape = (lines) => [...new Map(lines.map((line) => [line.replace(/\d+/g, "#"), line])).values()];

const withoutJavaType = (raw) => {
  const at = raw.lastIndexOf("&");
  return at < 0 ? raw : raw.slice(0, at);
};

const parseValue = (body) => {
  const single = body.match(SINGLE_VALUE);
  if (single) {
    const raw = withoutJavaType(single[2]);
    return { type: single[1], value: single[1] === "number" ? Number(raw) : readableValue(raw) };
  }
  const flat = body.replace(INNER_VALUE, (_, type, raw) => {
    const value = withoutJavaType(raw);
    if (type === "vector") return `vec(${value.split(",").map(Number).join(", ")})`;
    return type === "number" ? String(Number(value)) : readableValue(value);
  });
  if (body.startsWith("[")) return { type: "list", value: flat };
  if (body.startsWith("{")) return { type: "map", value: flat };
  return { type: "?", value: body };
};

let exchanges = Promise.resolve();

function oneAtATime(work) {
  const run = exchanges.then(work, work);
  exchanges = run.catch(() => {});
  return run;
}

async function awaitReply(command, isReply) {
  const watch = await Watch.start({ local: false });
  await send(command);
  const end = Date.now() + REPLY_WAIT;
  while (Date.now() < end) {
    await sleep(150);
    await watch.poll();
    const reply = watch.all.find((e) => e.type === "chat" && isReply(e.text ?? ""));
    if (reply) return reply;
    if (watch.chat.some((line) => REPLY.slowDown.test(line))) return null;
  }
  throw new GameError(`сервер не ответил на ${command}`);
}

async function askServer(command, isReply) {
  for (let attempt = 0; attempt < REPLY_TRIES; attempt++) {
    const reply = await awaitReply(command, isReply);
    if (reply) return reply;
  }
  throw new GameError(`сервер просит подождать: ${command}`);
}

const hoverBody = (part) => (part.hover?.startsWith(`${part.text}\n`) ? part.hover.slice(part.text.length + 1) : part.hover);

const listedVariables = (reply) =>
  (reply.parts ?? [])
    .filter((part) => /^[[{]/.test(hoverBody(part) ?? ""))
    .map((part) => ({ name: part.text, ...parseValue(hoverBody(part)) }));

const nextPageCommand = (reply) => (reply.parts ?? []).find((part) => part.run && part.text?.includes("▶"))?.run;

const answersVariables = (text) => isVariableList(text) || REPLY.noVariables.test(text) || REPLY.notPlaying.test(text);

export const variables = ({ scope = "game", query } = {}) => oneAtATime(async () => {
  let reply = await askServer(`/env var list ${scope}${query ? ` ${query}` : ""}`, answersVariables);
  if (REPLY.notPlaying.test(reply.text)) throw new GameError(`переменные читаются только в режиме игры: ${reply.text}`);
  if (REPLY.noVariables.test(reply.text)) return { total: 0, variables: [] };
  const found = new Map();
  const announced = listedTotal(reply.text);
  for (let page = 0; page < LIST_PAGES; page++) {
    const before = found.size;
    for (const variable of listedVariables(reply)) found.set(variable.name, variable);
    const next = nextPageCommand(reply);
    if (!next || found.size >= announced || found.size === before) break;
    reply = await askServer(next, answersVariables);
  }
  const total = Number.isNaN(announced) ? found.size : announced;
  return { total, variables: [...found.values()], ...(found.size < total ? { truncated: true, hint: `показано ${found.size} из ${total}: сузь query` } : {}) };
});

export async function worldNews() {
  const { events: list } = await events({ types: ["chat"], limit: NEWS_WINDOW });
  const last = (test) => [...list].reverse().find((e) => test(tidy(e.text ?? "")));
  const phase = last((text) => REPLY.buildMode.test(text) || REPLY.playMode.test(text));
  const stop = last(isWorldStop);
  return {
    ...(phase ? { phase: REPLY.buildMode.test(phase.text) ? "строительство" : "игра" } : {}),
    ...(stop ? { lastStop: { secondsAgo: Math.round((Date.now() - stop.t) / 1000), text: tidy(stop.text) } } : {}),
  };
}

export const limits = () => oneAtATime(async () => (await askServer("/world limit profile", isLimitsReport)).text);

export async function chatLines(limit = 60, { all = false } = {}) {
  const { events: list } = await events({ types: ["chat"], limit });
  return list
    .filter((e) => all || !isServiceReport(e.text ?? ""))
    .flatMap((e) => split(e.text ?? "").map((part) => ({ t: e.t, text: tidy(part) })))
    .filter((m) => m.text && (all || !GLOBAL_CHAT.test(m.text)));
}

function checkKeys(keys) {
  for (const k of keys) if (!KEYS.has(k)) throw new GameError(`нет клавиши «${k}»: ${[...KEYS].join(", ")}`);
}

export async function hold(keys, ms, signal) {
  checkKeys(keys);
  await post("/keys", { down: keys });
  try {
    await sleep(Math.min(ms, 60000), signal);
  } finally {
    await post("/keys", { up: keys }).catch(() => {});
  }
  return state();
}

export const look = async (target) => {
  const r = await post("/look", target, 8000);
  return r.result ?? r;
};

async function guardDev(action, force) {
  if (force || !["attack", "use"].includes(action)) return;
  const s = await state();
  if (s.mode === "dev") {
    throw new GameError("в /dev это опасно: удар по блоку-событию стирает строку, а открытие сундука аргументов намертво блокирует блок. Если всё же нужно: force: true");
  }
}

export async function click(action, { times = 1, force = false, signal } = {}) {
  if (!CLICKS.has(action)) throw new GameError(`нет действия «${action}»: ${[...CLICKS].join(", ")}`);
  await guardDev(action, force);
  await post("/click", { key: action, times: Math.min(times, 50) });
  await sleep(Math.min(times, 50) * 160 + 60, signal);
  return state();
}

export async function holdUse(ms, { force = false, signal } = {}) {
  await guardDev("use", force);
  return hold(["use"], ms, signal);
}

export async function guiClick({ slot, item, button = 0, input = "PICKUP" }) {
  let target = slot;
  if (item != null) {
    const pattern = new RegExp(item, "i");
    const found = (await gui()).items.find((i) => pattern.test(i.name) || pattern.test(i.id));
    if (!found) throw new GameError(`в окне нет предмета «${item}»`);
    target = found.slot;
  }
  await post("/gui/click", { slot: Number(target), button: Number(button), input: String(input) });
  await sleep(CLICK_SETTLE);
  return gui();
}

export async function guiClose() {
  await post("/gui/close");
  await sleep(CLOSE_SETTLE);
  return gui();
}

export async function goTo({ x, y, z, entity, tolerance, sprint = false, timeoutMs = 60000, signal }) {
  const deadline = Date.now() + Math.min(timeoutMs, 300000) + 5000;
  let r = await post("/goto", { x, y, z, entity, tolerance, sprint, timeoutMs: Math.min(timeoutMs, 300000), waitMs: 100 });
  while (!r.done) {
    if (signal?.aborted) {
      await releaseAll().catch(() => {});
      throw new Error("остановлено");
    }
    if (Date.now() > deadline) {
      await releaseAll().catch(() => {});
      throw new GameError("ходьба зависла");
    }
    r = await get(`/job?id=${r.job}&wait=${JOB_POLL}`, JOB_POLL + 6000);
  }
  const { ok, outcome, left } = r.result;
  return { arrived: ok || left <= NEAR_ENOUGH, outcome, left, state: await state() };
}

let shooting = Promise.resolve();

export function screenshots(spec = {}) {
  const run = shooting.then(() => post("/shot", spec, (spec.timeoutMs ?? 20000) + 5000));
  shooting = run.catch(() => {});
  return run;
}

export async function screenshotSeries({ count, everyMs, ...spec }) {
  const series = [];
  for (let frame = 0; frame < count; frame++) {
    if (frame) await sleep(everyMs);
    series.push(...(await screenshots(spec)));
  }
  return series;
}

export const track = (query = {}) => post("/track", query, (query.ms ?? 3000) + 8000);

export const recordStart = () => post("/record/start");
export const recordStop = () => post("/record/stop");
export const replay = (macro, timeoutMs = 600000) => post("/replay", { ...macro, timeoutMs }, timeoutMs + 5000);
