import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { decompile } from "../xero/core.mjs";
import { bridgePing, connect, firstLines, ping, post } from "../game/agent.mjs";
import { adoptWorld, knownWorld, worldOf } from "../game/deploy.mjs";
import { staleParts } from "../game/freshness.mjs";
import * as link from "../game/link.mjs";
import * as player from "../game/player.mjs";
import { serverStats } from "../game/replies.mjs";
import * as scripts from "../game/scripts.mjs";
import { clip, failure, images, register, text } from "./common.mjs";

const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

const compact = (s) => {
  if (!s?.inWorld) return s;
  const { uuid, dimension, ...rest } = s;
  for (const key of ["x", "y", "z", "yaw", "pitch"]) rest[key] = round(rest[key]);
  return rest;
};

const LETTERS = ".abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const AIR = new Set(["air", "void_air", "cave_air"]);
const LOG_SECONDS = 120;
const EVENT_WINDOW = 20000;
const CHAT_WINDOW = 2000;

const age = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 120 ? `-${seconds}с` : `-${Math.round(seconds / 60)}м`;
};
const TRACK_RADIUS = 64;
const MAX_SERIES_FRAMES = 8;

export function collapseEvents(list) {
  const out = [];
  for (const { seq, t, id, ...event } of list) {
    const key = JSON.stringify(event);
    const last = out.at(-1);
    if (last?.key === key) last.times++;
    else out.push({ key, event: { ...event, t, ...(id === undefined ? {} : { id }) }, times: 1 });
  }
  return out.map(({ event, times }) => (times > 1 ? { ...event, times } : event));
}

export function drawRegion(r) {
  const [sx, sy, sz] = r.size;
  const cells = r.cells.split(",").filter(Boolean).map(Number);
  const letter = new Map();
  let next = 1;
  r.palette.forEach((id, i) => {
    letter.set(i, AIR.has(id) ? "." : LETTERS[next++ % LETTERS.length]);
  });
  const legend = r.palette.map((id, i) => `${letter.get(i)}=${id}`).filter((entry) => !entry.startsWith(".=")).join(" ");
  const layers = [];
  for (let y = sy - 1; y >= 0; y--) {
    const rows = [];
    for (let z = 0; z < sz; z++) {
      let row = "";
      for (let x = 0; x < sx; x++) row += letter.get(cells[(y * sz + z) * sx + x]);
      rows.push(row);
    }
    if (rows.some((row) => /[^.]/.test(row))) layers.push(`y=${r.origin[1] + y}\n${rows.join("\n")}`);
  }
  return `начало ${r.origin.join(" ")}, размер ${sx}×${sy}×${sz}, строки по z, столбцы по x\n${legend}\n\n${layers.join("\n\n") || "только воздух"}`;
}

export function registerGame(server) {
  register(server, "world", {
    title: "Мир и состояние игры",
    description: "status: что запущено, где игрок, id мира, TPS и пинг сервера, в каком состоянии мир (phase) и когда код падал (lastStop). read: код мира на Xero из файла, который пишется при каждой заливке (out: записать в файл). Из игры мир не читается: правки руками в /dev файл не видит. adopt: начать мир без файла: без path мир считается пустым, path: json с handlers. log: ответы сервера за seconds секунд, по умолчанию 120. commands: дерево команд сервера (filter: regex).",
    schema: {
      action: z.enum(["status", "read", "adopt", "log", "commands"]),
      out: z.string().optional(),
      path: z.string().optional(),
      filter: z.string().optional(),
      seconds: z.number().int().min(1).max(3600).optional(),
    },
    readOnly: true,
  }, async ({ action, out, path, filter, seconds = LOG_SECONDS }) => {
    if (action === "adopt") return adoptWorld(path);
    if (action === "log") return link.log(Date.now() - seconds * 1000);
    if (action === "commands") {
      const pattern = filter ? new RegExp(filter, "i") : null;
      const list = (await player.commands(5)).filter((c) => !/^\/\S+:/.test(c) && (!pattern || pattern.test(c) || pattern.test(c.slice(1))));
      return list.length ? clip(list.join("\n")) : `Нет команд под фильтр «${filter}».`;
    }
    if (action === "status") {
      const r = {};
      r.bridge = await bridgePing();
      r.xerocode = await link.status().catch((e) => ({ ok: false, error: e.message }));
      if (r.bridge.ok) {
        r.agent = await ping().catch((e) => ({ error: e.message }));
        if (r.agent.inWorld) {
          const s = await player.state();
          r.world = worldOf(s.dimension);
          r.player = compact(s);
          r.server = serverStats(await player.hud());
          Object.assign(r, await player.worldNews());
        }
      }
      const stale = staleParts();
      return stale.length ? { warnings: stale, ...r } : r;
    }
    const { status, handlers } = await knownWorld();
    if (!handlers.length) return `В мире ${status.world} кода нет.`;
    const r = decompile(JSON.stringify({ handlers }));
    const head = `Мир ${status.world}: строк ${r.lines}, блоков ${r.blocks}.`;
    if (!out) return `${head}\n\n${clip(r.text)}`;
    writeFileSync(out, r.text);
    return `${head}\nЗаписано: ${resolve(out)}`;
  });

  register(server, "player", {
    title: "Управление игроком",
    description: `Настоящий игрок в клиенте, по тикам. Для проверки кода есть test, здесь ручная разведка.
state · inventory · chat (limit, match; all: и глобальный чат) · say (text) · look (x,y,z | yaw,pitch | entity; ticks: плавно) · move (keys, ms) · goto (x,y,z | entity; A* вокруг препятствий, sprint) · use · attack · drop · swap_hands · pick · hotbar (slot) · gui (окно) · click (slot|item, button, input) · close · respawn (с экрана смерти) · stop (отпустить всё).
В /dev use и attack запрещены без force: удар по блоку-событию стирает строку, открытие сундука аргументов блокирует блок.`,
    schema: {
      action: z.enum(["state", "inventory", "chat", "say", "look", "move", "goto", "use", "attack", "drop", "swap_hands", "pick", "hotbar", "gui", "click", "close", "respawn", "stop"]),
      x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
      yaw: z.number().optional(), pitch: z.number().optional(),
      entity: z.string().optional().describe("uuid или regex имени и типа"),
      ticks: z.number().int().optional(),
      text: z.string().optional(),
      keys: z.array(z.enum(["forward", "back", "left", "right", "jump", "sneak", "sprint"])).optional(),
      ms: z.number().int().optional(),
      slot: z.number().int().optional(),
      item: z.string().optional(),
      button: z.number().int().optional(),
      input: z.string().optional(),
      times: z.number().int().optional(),
      limit: z.number().int().optional(),
      match: z.string().optional(),
      all: z.boolean().optional(),
      sprint: z.boolean().optional(),
      force: z.boolean().optional(),
    },
    openWorld: true,
  }, async (a) => {
    switch (a.action) {
      case "state": return compact(await player.state());
      case "inventory": return player.inventory();
      case "chat": {
        const pattern = a.match ? new RegExp(a.match, "i") : null;
        const now = Date.now();
        const lines = (await player.chatLines(CHAT_WINDOW, { all: a.all })).filter((m) => !pattern || pattern.test(m.text));
        return lines.slice(-(a.limit ?? 30)).map((m) => `${age(now - m.t)} ${m.text}`);
      }
      case "say": {
        const watch = await player.Watch.start();
        await player.send(a.text);
        await player.sleep(a.ms ?? 600);
        return { sent: a.text, answers: await watch.poll() };
      }
      case "look": {
        await player.look({ x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, entity: a.entity, ticks: a.ticks });
        return compact(await player.state());
      }
      case "move": return compact(await player.hold(a.keys ?? ["forward"], a.ms ?? 500));
      case "goto": {
        const r = await player.goTo({ x: a.x, y: a.y, z: a.z, entity: a.entity, sprint: a.sprint });
        return { ...r, state: compact(r.state) };
      }
      case "use":
      case "attack":
      case "drop":
      case "swap_hands":
      case "pick": return compact(await player.click(a.action, { times: a.times ?? 1, force: a.force }));
      case "hotbar":
        await player.setHotbar(a.slot);
        return compact(await player.state());
      case "gui": return player.gui({ all: a.all });
      case "click": return player.guiClick(a);
      case "close": return player.guiClose();
      case "respawn":
        await player.respawn();
        await player.sleep(500);
        return compact(await player.state());
      case "stop":
        await player.releaseAll();
        return compact(await player.state());
      default: throw new Error(`нет действия ${a.action}`);
    }
  });

  register(server, "see", {
    title: "Что видит клиент",
    description: `Без снимка: точные данные из клиента.
hud: экшенбар, тайтл, боссбары, скорборд, таб.
displays: визуализаторы с полным состоянием (смещение, размер, поворот в кватернионах и углах, режим, текст, фон, яркость, интерполяция, блок, предмет). Фильтры: type, name, text, radius, x,y,z, limit.
entities: сущности с теми же фильтрами, радиус по умолчанию 32 от камеры, клиент не видит дальше примерно 48 блоков. summary=true вместо списка даёт счёт по типу и имени: цифры в именах свёрнуты в #, k12 и k13 это одна строка.
track: замер движения по кадрам за ms (до 20000, по умолчанию 3000): рывки, откаты, паузы и сбросы интерполяции у каждой части и сколько сущность прошла. Рывок: всплеск больше 0.1 блока на фоне спокойных соседних кадров, быстрый замах им не считается. Фильтры type, name, radius. Главный способ понять, почему анимация дёргается, и доказать, что больше нет. Окно игры без фокуса режет частоту до 30 кадров, поле fps это покажет.
block (x,y,z): блок со свойствами и текстом таблички. region (x,y,z,radius,height или x1..z2): карта блоков послойно.
vars: настоящие значения переменных мира, только в режиме игры: scope game или save, query часть имени.
limits: нагрузка и лимиты мира прямо сейчас (/world limit profile). Смотри tick20Mspt и счётчики скачков, поле CPU не про твой мир.
events: журнал сети за seconds секунд, types: chat actionbar title subtitle bossbar sound particle entity_add entity_remove block screen teleport health effect explosion motion display_data display_move gamemode respawn disconnect. match: regex.`,
    schema: {
      action: z.enum(["hud", "displays", "entities", "track", "block", "region", "events", "vars", "limits"]),
      x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
      x1: z.number().int().optional(), y1: z.number().int().optional(), z1: z.number().int().optional(),
      x2: z.number().int().optional(), y2: z.number().int().optional(), z2: z.number().int().optional(),
      radius: z.number().optional(),
      height: z.number().int().optional(),
      type: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      limit: z.number().int().optional(),
      summary: z.boolean().optional(),
      ms: z.number().int().min(100).max(20000).optional(),
      types: z.array(z.string()).optional(),
      seconds: z.number().optional(),
      match: z.string().optional(),
      scope: z.enum(["game", "save"]).optional(),
      query: z.string().optional(),
    },
    readOnly: true,
  }, async (a) => {
    switch (a.action) {
      case "hud": return player.hud();
      case "vars": return player.variables({ scope: a.scope, query: a.query });
      case "limits": return player.limits();
      case "displays":
      case "entities": {
        const { x, y, z, radius, type, name, text: wanted, limit, summary } = a;
        const found = await player.scene({ x, y, z, radius, type, name, text: wanted, limit: summary ? 0 : limit, displays: a.action === "displays" });
        if (summary) return { total: found.total, counts: found.counts };
        const { counts, ...rest } = found;
        return clip(JSON.stringify(rest, null, 1));
      }
      case "track": {
        const { x, y, z, radius = TRACK_RADIUS, type, name, ms } = a;
        return clip(JSON.stringify(await player.track({ x, y, z, radius, type, name, ms }), null, 1));
      }
      case "block": return player.block(a);
      case "region": {
        const { x, y, z, x1, y1, z1, x2, y2, z2, radius, height } = a;
        return clip(drawRegion(await player.region({ x, y, z, x1, y1, z1, x2, y2, z2, radius, height })));
      }
      case "events": {
        const since = Date.now() - (a.seconds ?? 30) * 1000;
        const pattern = a.match ? new RegExp(a.match, "i") : null;
        const { events } = await player.events({ types: a.types, limit: EVENT_WINDOW });
        const list = events.filter((e) => e.t >= since && (!pattern || pattern.test(JSON.stringify(e))));
        const shown = collapseEvents(list).slice(-(a.limit ?? 200));
        const cut = events.length === EVENT_WINDOW ? `журнал полон только за ${age(Date.now() - events[0].t)}\n` : "";
        return clip(`${cut}${JSON.stringify(shown)}`);
      }
      default: throw new Error(`нет действия ${a.action}`);
    }
  });

  register(server, "screenshot", {
    title: "Снимок экрана",
    description: "Что на экране Minecraft. Камера не двигает игрока и ничего не шлёт на сервер: camera {x,y,z, lookAt:{x,y,z} | yaw,pitch} снимает из любой точки, orbit {x,y,z,radius,height,views} обходит точку по кругу, это главный способ разглядеть модель из визуализаторов со всех сторон. frames {count,everyMs} снимает серию кадров подряд: так видно анимацию. На время съёмки интерфейс скрыт. Вызовы идут по очереди.",
    schema: {
      full: z.boolean().optional().describe("Полный размер, иначе вполовину"),
      camera: z.object({
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        yaw: z.number().optional(), pitch: z.number().optional(),
        lookAt: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
      }).optional(),
      orbit: z.object({
        x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
        radius: z.number().optional(), height: z.number().optional(), views: z.number().int().optional(), start: z.number().optional(),
      }).optional(),
      frames: z.object({
        count: z.number().int().min(2).max(MAX_SERIES_FRAMES),
        everyMs: z.number().int().min(0).max(5000).optional(),
      }).optional(),
    },
    readOnly: true,
  }, async ({ full, camera, orbit, frames }) => {
    const spec = { downscale: full ? 1 : 2, camera, orbit, timeoutMs: 30000 };
    const list = frames ? await player.screenshotSeries({ ...spec, count: frames.count, everyMs: frames.everyMs ?? 0 }) : await player.screenshots(spec);
    if (!list.length) return failure("снимок не получился");
    const { inline, saved } = images(list);
    return { content: [...inline, ...(saved.length ? [{ type: "text", text: `Не вошло в ответ, лежит на диске: ${saved.join(", ")}` }] : [])] };
  });

  register(server, "execute", {
    title: "Выполнить Java в клиенте",
    description: `BeanShell внутри клиента Minecraft 26.2, имена Mojang. В области видимости: mc, api (player world entities playerNames send toast screen dump), p(x) строка в out. Каждый вызов живёт в своей области, keep=true пишет в общую, reset=true её чистит. Если метода нет, ошибка покажет похожие настоящие. Работает через агента: зависший вызов уже не убивает связь, он отваливается по timeoutMs.
Сначала посмотри, нет ли готового: see entities summary считает сущности, see track меряет движение, см. script для долгого.
Нельзя: varargs; Screenshot.grab с null; mc.gui.setScreen(null) при открытом меню сервера (закрывай mc.player.closeContainer()); пакеты, которые клиент шлёт сам; сеть на главном потоке.`,
    schema: {
      code: z.string().optional(),
      onClientThread: z.boolean().optional(),
      timeoutMs: z.number().int().optional(),
      reset: z.boolean().optional(),
      keep: z.boolean().optional(),
    },
    destructive: true,
    openWorld: true,
  }, async ({ code, onClientThread = true, timeoutMs = 8000, reset, keep }) => {
    const r = await post("/exec", { code, onClientThread, timeoutMs, reset, keep }, timeoutMs + 4000);
    if (!code) return "готово";
    if (r.ok) return { result: r.result, out: r.out, ms: r.ms };
    return failure(`${firstLines(r.error, 14)}${r.out ? `\nout: ${r.out}` : ""}`);
  });

  register(server, "script", {
    title: "Скрипты и запись",
    description: `Библиотека на диске: save (name, code, kind, description) · list · show (name) · run (name, args, background) · wait (job, seconds: дождаться фоновой задачи до 100 с, вернуть статус, лог и итог; без job последняя) · stop (job) · delete (name) · record (name: начать запись игрока) · record_stop (name: сохранить).
kind=java: BeanShell в клиенте, значения запуска в args (HashMap).
kind=js: сценарий снаружи игры, может ждать и работать долго. Доступны game (state look hold holdUse walk say sleep inventory gui guiClick guiClose click scene track variables hud block region events screenshots setHotbar java toDev toPlay restartWorld, Watch), args, log. Что вернул код, придёт в result: game.scene({type:"husk"}) вместо ручного обхода сущностей.
kind=macro: запись игрока: клавиши, поворот, слот, чат по тикам, воспроизводится покадрово.`,
    schema: {
      action: z.enum(["save", "list", "show", "run", "wait", "stop", "delete", "record", "record_stop"]),
      name: z.string().optional(),
      code: z.string().optional(),
      kind: z.enum(["java", "js", "macro"]).optional(),
      description: z.string().optional(),
      args: z.record(z.string(), z.any()).optional(),
      background: z.boolean().optional(),
      onClientThread: z.boolean().optional().describe("java: false, если код долгий: иначе игра замрёт на время работы"),
      job: z.number().int().optional(),
      seconds: z.number().int().min(1).max(100).optional(),
      timeoutMs: z.number().int().optional(),
    },
    openWorld: true,
  }, async (a) => {
    switch (a.action) {
      case "save": return scripts.save(a);
      case "list": return { scripts: scripts.list(), jobs: scripts.jobList() };
      case "show": return text(clip(JSON.stringify(scripts.read(a.name), null, 1)));
      case "run": return scripts.start(a);
      case "wait": return scripts.waitFor(a.job, a.seconds);
      case "stop": {
        const r = scripts.stop(a.job);
        await player.releaseAll().catch(() => {});
        return r;
      }
      case "delete": return scripts.remove(a.name);
      case "record":
        await connect();
        await player.recordStart();
        return "запись пошла: всё, что делает игрок, пишется по тикам. Конец: record_stop";
      case "record_stop": return scripts.recordStop(a);
      default: throw new Error(`нет действия ${a.action}`);
    }
  });
}
