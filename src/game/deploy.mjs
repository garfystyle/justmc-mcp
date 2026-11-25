import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, plan } from "../xero/core.mjs";
import { WORKSPACE } from "../paths.mjs";
import { GameError } from "./agent.mjs";
import * as link from "./link.mjs";
import { commandGap, sleep, state } from "./player.mjs";
import { REPLY } from "./replies.mjs";

const LISTED = 12;
const SOURCE_MARK = "xs1:";
const UPLOAD_RETRIES = 3;
const UPLOAD_RETRY_MS = 3000;
const NETWORK_FAILURE = /связь оборвалась|соединени|timed? ?out|ECONN/i;
const SIZE_WARNING = 0.8;
const LINES_WARNING = 325;
const KEEP_BACKUPS = 40;
const listed = (items) => items.slice(0, LISTED).join(", ") + (items.length > LISTED ? ` … и ещё ${items.length - LISTED}` : "");

export function open(k, { code, path, debug }) {
  return new Project({ code, path, debug, modules: (wanted, connect) => k.importable(wanted, connect) });
}

export function compile(k, source) {
  if (source.path && resolve(source.path).toLowerCase().endsWith(".json")) {
    if (!existsSync(source.path)) throw new Error(`нет файла ${source.path}`);
    const module = readFileSync(source.path, "utf8");
    const handlers = JSON.parse(module).handlers;
    if (!Array.isArray(handlers)) throw new Error("нет поля handlers: это не код мира");
    return { ok: true, module, lines: handlers.length, blocks: 0, connected: [], diagnostics: [] };
  }
  const project = open(k, source);
  return { ...project.build(), texts: project.texts };
}

const strip = (value) => {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "position") continue;
    if (key === "custom_data" && typeof value[key] === "string" && value[key].startsWith(SOURCE_MARK)) continue;
    out[key] = key === "item" || key === "default_value" ? "*" : strip(value[key]);
  }
  return out;
};

export const fingerprint = (handler) => createHash("sha1").update(JSON.stringify(strip(handler))).digest("hex");
const owned = (world, name) => join(WORKSPACE, "owned", `${world}${name ? `-${name.replace(/[^\p{L}\p{N}_-]/gu, "_")}` : ""}.json`);

function readOwned(world, name) {
  const file = owned(world, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

const claimer = (mine) => {
  const left = new Map();
  for (const print of mine) left.set(print, (left.get(print) ?? 0) + 1);
  return (handler) => {
    const print = fingerprint(handler);
    const count = left.get(print) ?? 0;
    if (!count) return false;
    left.set(print, count - 1);
    return true;
  };
};

function saveOwned(world, name, handlers) {
  mkdirSync(join(WORKSPACE, "owned"), { recursive: true });
  writeFileSync(owned(world, name), JSON.stringify(handlers.map(fingerprint)));
}

function backup(world, handlers) {
  if (!handlers.length) return null;
  const dir = join(WORKSPACE, "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${world}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ handlers }));
  pruneBackups(dir, world);
  return file;
}

export function pruneBackups(dir, world, keep = KEEP_BACKUPS) {
  const own = readdirSync(dir).filter((f) => f.startsWith(`${world}-`) && f.endsWith(".json")).sort();
  for (const f of own.slice(0, Math.max(0, own.length - keep))) rmSync(join(dir, f), { force: true });
}

const worldFile = (world) => join(WORKSPACE, "worlds", `${world}.json`);

export function readWorldFile(world) {
  const file = worldFile(world);
  if (!existsSync(file)) {
    throw new GameError(`Нет файла кода мира ${world}: ${file}. Заливка идёт с заменой всего кода, поэтому сначала: в мире есть код — world action=pull в /dev (прочитать его из игры) или world action=adopt path=<json с handlers>; мир пустой — world action=adopt без path.`);
  }
  return JSON.parse(readFileSync(file, "utf8")).handlers;
}

export function saveWorldFile(world, handlers) {
  mkdirSync(join(WORKSPACE, "worlds"), { recursive: true });
  writeFileSync(worldFile(world), JSON.stringify({ handlers }));
}

export const worldOf = (dimension) => String(dimension ?? "").match(/world_([0-9a-f]{8})/)?.[1] ?? null;

async function currentWorld() {
  const s = await state();
  const world = worldOf(s?.dimension);
  if (!world) throw new GameError("игрок не в мире Creative+: зайди в свой мир");
  return { world, dev: s.mode === "dev" };
}

export async function knownWorld() {
  const status = await currentWorld();
  return { status, handlers: readWorldFile(status.world) };
}

export async function adoptWorld(path) {
  if (!path) {
    const { world } = await currentWorld();
    saveWorldFile(world, []);
    return `Мир ${world} принят пустым. Если код в нём всё-таки есть, первая заливка его сотрёт.`;
  }
  if (!existsSync(path)) throw new Error(`нет файла ${path}`);
  const { handlers } = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(handlers)) throw new Error("нет поля handlers: это не код мира");
  const status = await currentWorld();
  saveWorldFile(status.world, handlers);
  return `Файл мира ${status.world}: строк ${handlers.length}.`;
}

export async function pullWorld() {
  const { world, dev } = await currentWorld();
  if (!dev) throw new GameError("код мира читается из /dev: перейди туда и повтори");
  const { handlers, unread } = await link.world();
  if (unread === undefined) throw new GameError("этот XeroCode не говорит, все ли строки мира прочитались: обнови мод, файл мира не тронут");
  if (unread > 0) throw new GameError(`не прочиталось строк: ${unread} (сервер не кладёт большие строки в шаблон, а /editor download не отдал код). С таким файлом следующая заливка сотрёт эти строки, поэтому файл мира не тронут.`);
  const file = worldFile(world);
  const known = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).handlers : null;
  const saved = known?.length ? backup(world, known) : null;
  saveWorldFile(world, handlers);
  const notes = [`Код мира ${world} прочитан из игры: строк ${handlers.length}. Файл мира обновлён.`];
  if (known) {
    const p = plan(known.length ? JSON.stringify({ handlers: known }) : "", JSON.stringify({ handlers }));
    const edited = p.changed.length - p.moved;
    notes.push(edited || p.added.length || p.missing.length
      ? `Против прежнего файла: изменено ${edited}, появилось ${p.added.length}, пропало ${p.missing.length}.`
        + (p.changed.length ? `\nизменено: ${listed(p.changed)}` : "") + (p.added.length ? `\nпоявилось: ${listed(p.added)}` : "")
        + (p.missing.length ? `\nпропало: ${listed(p.missing)}` : "")
      : "Против прежнего файла ничего не изменилось.");
  }
  if (saved) notes.push(`Прежний файл: ${saved}`);
  notes.push("Код — world действие read.");
  return notes.join("\n");
}

const summary = (p) =>
  [`Без изменений ${p.same}, изменено ${p.changed.length}${p.moved ? `, сдвинуто ${p.moved}` : ""}, новых ${p.added.length}, сотрётся ${p.missing.length}.`,
    p.changed.length ? `изменено: ${listed(p.changed)}` : "",
    p.added.length ? `новые: ${listed(p.added)}` : "",
    p.missing.length ? `сотрётся: ${listed(p.missing)}` : ""].filter(Boolean).join("\n");

export function merge(mine, handlers, project) {
  const ours = claimer(mine);
  const keep = handlers.filter((h) => !ours(h));
  const names = new Set(project.filter((h) => h.type !== "event").map((h) => `${h.type}:${h.name}`));
  const sameName = (h) => h.type !== "event" && names.has(`${h.type}:${h.name}`);
  const clashes = keep.filter(sameName).map((h) => `${h.type} ${h.name}`);
  const others = keep.filter((h) => !sameName(h));
  const taken = new Set(others.map((h) => h.position).filter((p) => Number.isInteger(p)));
  let next = 0;
  const placed = project.map((h) => {
    while (taken.has(next)) next++;
    taken.add(next);
    return { ...h, position: next };
  });
  const events = new Set(others.filter((h) => h.type === "event").map((h) => h.event));
  const twins = [...new Set(project.filter((h) => h.type === "event" && events.has(h.event)).map((h) => h.event))];
  return { handlers: [...others, ...placed], kept: others.length, twins, clashes };
}

async function uploadModule(module) {
  for (let attempt = 0; ; attempt++) {
    await commandGap();
    let sent;
    try {
      sent = await link.upload(module, true);
    } catch (e) {
      if (attempt >= UPLOAD_RETRIES || !NETWORK_FAILURE.test(e.message)) throw e;
      await sleep(UPLOAD_RETRY_MS);
      continue;
    }
    if (sent.done !== false) return;
    const said = (sent.answers ?? []).join(" · ");
    if (REPLY.oldUploadCommand.test(said)) {
      throw new Error("Запущенный мод XeroCode шлёт старую команду /module loadUrl, а сервер с 07.11.2026 знает только load-url. Нужен перезапуск игры с новым jar из mods/.");
    }
    if (attempt >= UPLOAD_RETRIES || !REPLY.slowDown.test(said)) {
      throw new Error(`Сервер не подтвердил заливку: ${said || "ответа нет"}`);
    }
    await sleep(UPLOAD_RETRY_MS);
  }
}

export async function removeProject({ name, dry = false }) {
  const { status, handlers } = await knownWorld();
  const ours = claimer(readOwned(status.world, name));
  const kept = handlers.filter((h) => !ours(h));
  const removed = handlers.length - kept.length;
  if (!removed) return { notes: ["Строк этого проекта в мире нет."], warnings: [] };
  if (dry) return { notes: [`Сотрётся строк: ${removed}, останется ${kept.length}.`], warnings: [] };
  const saved = backup(status.world, handlers);
  await uploadModule(JSON.stringify({ handlers: kept }));
  saveWorldFile(status.world, kept);
  saveOwned(status.world, name, []);
  return { notes: [`Строк проекта убрано: ${removed}, осталось ${kept.length}.`, `Копия мира: ${saved}`], warnings: [] };
}

export async function deploy(built, { mode = "project", drop = false, dry = false, resend = false, name } = {}) {
  const project = JSON.parse(built.module).handlers;
  if (!project.length) throw new Error("в коде нет ни одной строки (when, func, process)");
  const { status, handlers } = await knownWorld();
  const world = status.world;
  const notes = [];
  const warnings = [];
  const target = mode === "project" ? merge(readOwned(world, name), handlers, project) : { handlers: project, kept: 0, twins: [], clashes: [] };
  if (target.clashes.length) {
    const foreign = `В мире уже есть строки с этими именами, и залиты они не этим проектом: ${listed(target.clashes)}.`;
    if (!dry && !drop) throw new Error(`Не залито: ${foreign} Они заменились бы молча, и чужой код сломался бы. Переименуй свои или подтверди drop=true, если это твои старые строки.`);
    warnings.push(`${foreign} ${drop ? "Они заменены." : "Заливка откажет без drop=true."}`);
  }
  if (target.kept) notes.push(`Другие строки мира сохранены: ${target.kept}.`);
  if (built.sources && !built.sources.fits) {
    warnings.push(`Исходник в мир не положен: нужно строк ${built.sources.chunks > 1e9 ? "больше, чем есть (он больше 16 МБ)" : built.sources.chunks}, свободных ${built.sources.room}. Из мира код прочитается декомпиляцией.`);
  }
  if (target.twins.length) warnings.push(`В мире есть другие строки этих событий, сработают обе: ${listed(target.twins)}.`);
  const module = JSON.stringify({ handlers: target.handlers });
  const p = plan(handlers.length ? JSON.stringify({ handlers }) : "", module);
  notes.push(summary(p));
  const lines = target.handlers.length;
  if (lines >= LINES_WARNING) warnings.push(`Строк в мире ${lines}: старый мир вмещает 345, новый этаж по расчёту 525. Сервер отказывает только в момент заливки: «Не хватает места».`);
  if (p.bytes > p.limit * SIZE_WARNING) warnings.push(`Модуль ${Math.round(p.bytes / 1024)} КБ из ${Math.round(p.limit / 1024)}: близко к пределу сервера.`);
  if (mode === "project" && p.missing.length && !name) {
    warnings.push(`Заливка сотрёт строки прошлой заливки, которых нет в этом коде: ${listed(p.missing)}. Если они нужны, держи их в коде или разводи проекты параметром project.`);
  }
  if (dry) return { sent: false, notes, warnings };
  if (mode === "world" && p.missing.length && !drop) {
    throw new Error(`Не залито: замена сотрёт строки мира, которых нет в коде: ${listed(p.missing)}.\nУбери mode=world, тогда они останутся, или подтверди drop=true.`);
  }
  if (p.bytes > p.limit) throw new Error("Не залито: сервер берёт модуль не больше 5 МБ");
  const saved = backup(world, handlers);
  if (saved && (p.changed.length || p.moved || p.missing.length)) notes.push(`Копия мира: ${saved}`);
  if (!resend && !p.changed.length && !p.moved && !p.added.length && !p.missing.length) {
    notes.push("По файлу мира код уже там, заливка пропущена. Если мир откатился или код правили руками, файл этого не знает: resend=true.");
  } else {
    await uploadModule(p.module);
    saveWorldFile(world, JSON.parse(p.module).handlers);
    notes.push("Код залит.");
  }
  if (mode === "project") saveOwned(world, name, project);
  for (const entry of built.connected ?? []) {
    const answer = await link.connect(entry);
    notes.push(`Модуль ${entry.name}: ${answer.said}`);
  }
  return { sent: true, notes, warnings };
}
