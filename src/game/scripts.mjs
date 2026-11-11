import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS } from "../paths.mjs";
import { firstLines, post } from "./agent.mjs";
import * as modes from "./modes.mjs";
import * as player from "./player.mjs";
import { isServerAlert } from "./replies.mjs";
import { scenarioRunning } from "./scenario.mjs";

const NAME = /^[\p{L}\p{N}_-]{1,64}$/u;
const EXTENSIONS = { java: "bsh", js: "js", macro: "macro.json" };
const AsyncFunction = (async () => {}).constructor;
const LOG_LIMIT = 400;
const MAX_WAIT_SECONDS = 100;
const ERRORS_SHOWN = 10;

const jobs = new Map();
let nextJob = 1;

const check = (name) => {
  if (!NAME.test(name ?? "")) throw new Error("имя скрипта: буквы, цифры, _ и -");
  return name;
};
const metaFile = (name) => join(SCRIPTS, `${name}.json`);
const codeFile = (name, kind) => join(SCRIPTS, `${name}.${EXTENSIONS[kind]}`);

export function save({ name, code, kind = "java", description = "", params = [] }) {
  check(name);
  if (!EXTENSIONS[kind]) throw new Error("kind: java, js или macro");
  if (kind === "js") new AsyncFunction("game", "args", "log", code);
  mkdirSync(SCRIPTS, { recursive: true });
  const before = existsSync(metaFile(name)) ? JSON.parse(readFileSync(metaFile(name), "utf8")) : null;
  if (before && before.kind !== kind) rmSync(codeFile(name, before.kind), { force: true });
  writeFileSync(codeFile(name, kind), code);
  writeFileSync(metaFile(name), JSON.stringify({ name, kind, description, params, updated: new Date().toISOString() }, null, 2));
  return { saved: name, kind, replaced: Boolean(before) };
}

export function list() {
  if (!existsSync(SCRIPTS)) return [];
  return readdirSync(SCRIPTS)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".macro.json"))
    .map((f) => JSON.parse(readFileSync(join(SCRIPTS, f), "utf8")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function read(name) {
  check(name);
  if (!existsSync(metaFile(name))) throw new Error(`нет скрипта «${name}»`);
  const meta = JSON.parse(readFileSync(metaFile(name), "utf8"));
  return { ...meta, code: readFileSync(codeFile(name, meta.kind), "utf8") };
}

export function remove(name) {
  const meta = read(name);
  rmSync(metaFile(name), { force: true });
  rmSync(codeFile(name, meta.kind), { force: true });
  return { removed: name };
}

const javaString = (value) => JSON.stringify(String(value));

function javaArgs(args) {
  const lines = ["args = new java.util.HashMap();"];
  for (const [k, v] of Object.entries(args ?? {})) lines.push(`args.put(${javaString(k)}, ${javaString(v)});`);
  return lines.join("\n");
}

async function java(code, { timeoutMs = 8000, onClientThread = true, keep } = {}) {
  const r = await post("/exec", { code, timeoutMs, onClientThread, keep }, timeoutMs + 3000);
  if (!r.ok) throw new Error(firstLines(r.error, 10));
  return r.result;
}

function gameApi(signal, log, timeoutMs) {
  const guarded = {};
  for (const [name, fn] of Object.entries(player)) {
    if (typeof fn !== "function" || /^[A-Z]/.test(name)) continue;
    guarded[name] = (...a) => {
      signal.throwIfAborted();
      return fn(...a);
    };
  }
  return {
    ...guarded,
    Watch: player.Watch,
    sleep: (ms) => player.sleep(ms, signal),
    walk: (opts) => player.goTo({ ...opts, signal }),
    say: (text) => player.send(text, signal),
    hold: (keys, ms) => player.hold(keys, ms, signal),
    toDev: modes.toDev,
    toPlay: () => modes.switchMode("play"),
    restartWorld: modes.restartWorld,
    java: (code, options) => java(code, { timeoutMs, ...options }),
    log,
    signal,
  };
}

async function runJs(job, code, args, timeoutMs) {
  const log = (...parts) => {
    job.log.push(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
    if (job.log.length > LOG_LIMIT) job.log.shift();
  };
  const fn = new AsyncFunction("game", "args", "log", code);
  const watch = await player.Watch.start().catch(() => null);
  try {
    job.result = await fn(gameApi(job.controller.signal, log, timeoutMs), args ?? {}, log);
    job.status = "готово";
  } catch (e) {
    job.status = job.controller.signal.aborted ? "остановлено" : "ошибка";
    job.error = e.message;
  } finally {
    job.ended = Date.now();
    await player.releaseAll().catch(() => {});
    await watch?.poll().catch(() => {});
    job.errors = [...new Set((watch?.chat ?? []).filter(isServerAlert))].slice(-ERRORS_SHOWN);
  }
}

export async function start({ name, args, background = false, timeoutMs = 8000, onClientThread = true }) {
  if (scenarioRunning()) throw new Error("идёт test: он перезапускает мир и собьёт скрипт, дождись его");
  const script = read(name);
  if (script.kind === "java") {
    const r = await post("/exec", { code: `${javaArgs(args)}\n${script.code}`, timeoutMs, onClientThread }, timeoutMs + 3000);
    if (!r.ok) return { ok: false, error: firstLines(r.error, 12), out: r.out };
    return { ok: true, result: r.result, out: r.out, ms: r.ms };
  }
  if (script.kind === "macro") return player.replay(JSON.parse(script.code));
  const id = nextJob++;
  const job = { id, name, status: "идёт", log: [], started: Date.now(), controller: new AbortController() };
  jobs.set(id, job);
  job.finished = runJs(job, script.code, args, timeoutMs);
  if (background) return { job: id, status: job.status };
  await job.finished;
  return view(job);
}

export async function waitFor(id, seconds = MAX_WAIT_SECONDS) {
  const job = id == null ? [...jobs.values()].at(-1) : jobs.get(id);
  if (!job) throw new Error(id == null ? "фоновых задач нет" : `нет задачи ${id}`);
  await Promise.race([job.finished, player.sleep(Math.min(seconds, MAX_WAIT_SECONDS) * 1000)]);
  return view(job);
}

const view = (job) => ({
  job: job.id,
  name: job.name,
  status: job.status,
  seconds: Math.round(((job.ended ?? Date.now()) - job.started) / 100) / 10,
  ...(job.error ? { error: job.error } : {}),
  ...(job.errors?.length ? { errors: job.errors } : {}),
  ...(job.result !== undefined ? { result: job.result } : {}),
  log: job.log.slice(-60),
});

export const jobList = () => [...jobs.values()].map(({ id, name, status, error }) => ({ job: id, name, status, ...(error ? { error } : {}) }));

export const runningScripts = () => [...jobs.values()].filter((job) => job.status === "идёт").map((job) => job.name);

export function stop(id) {
  const running = id == null ? [...jobs.values()].filter((j) => j.status === "идёт") : [jobs.get(id)].filter(Boolean);
  for (const job of running) job.controller.abort();
  return { stopped: running.map((j) => j.id) };
}

export function stopAll() {
  for (const job of jobs.values()) job.controller.abort();
}

export async function recordStop({ name, description }) {
  const macro = await player.recordStop();
  save({ name, kind: "macro", code: JSON.stringify(macro), description: description ?? `Запись ${Math.round(macro.ticks / 20)} с` });
  return { saved: name, ticks: macro.ticks, frames: macro.frames.length };
}
