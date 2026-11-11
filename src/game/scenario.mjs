import { firstLines, post } from "./agent.mjs";
import { inBuildMode, restartWorld, switchMode } from "./modes.mjs";
import * as player from "./player.mjs";
import { isServerAlert, isServerFailure, isWorldStop } from "./replies.mjs";

const EVENT_VERBS = {
  actionbar: ["actionbar", (e) => e.text],
  title: ["title", (e) => e.text],
  subtitle: ["subtitle", (e) => e.text],
  bossbar: ["bossbar", (e) => e.text ?? ""],
  sound: ["sound", (e) => e.id],
  particle: ["particle", (e) => e.id],
  effect: ["effect", (e) => e.id],
};
const UNORDERED = new Set(["sound", "particle", "effect"]);
const VERBS = new Set([
  "say", "wait", "expect", "absent", "goto", "look", "move", "jump", "sneak", "use", "attack", "drop", "hotbar",
  "gui", "click", "close", "item", "no_item", "state", "java", "screenshot", "sidebar", "tab", "block", "entity",
  "display", "no_entity", "event", "shot", "respawn", "var", "no_var", "track", "limits", ...Object.keys(EVENT_VERBS),
]);
const DEFAULT_BUDGET_SECONDS = 100;
const TRACK_RADIUS = 64;
const LOAD_LINES = /tick20Mspt|boostMsptCounter|superBoostMsptCounter|blockChangesCount/;

let running = false;
export const scenarioRunning = () => running;

export function validate(steps) {
  steps.forEach((step, i) => {
    const verb = Object.keys(step).find((key) => VERBS.has(key));
    if (!verb) throw new Error(`шаг ${i + 1}: нет глагола. Есть: ${[...VERBS].join(", ")}`);
  });
}

async function until(check, timeoutMs, describe) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await check();
    if (last.ok) return last;
    if (Date.now() >= end) throw new Error(describe(last));
    await player.sleep(150);
  }
}

const matches = (pattern) => new RegExp(pattern, "i");
const itemMatches = (item, wanted) => {
  const pattern = matches(wanted);
  return pattern.test(item.id) || pattern.test(item.name) || (item.lore ?? []).some((l) => pattern.test(l));
};

function compare(s, wanted) {
  const wrong = [];
  for (const [key, value] of Object.entries(wanted)) {
    if (key === "near") {
      const { x, y, z, radius = 2 } = value;
      const distance = Math.hypot(s.x - x, y == null ? 0 : s.y - y, s.z - z);
      if (distance > radius) wrong.push(`не рядом с ${x} ${y ?? ""} ${z}: стоит ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${s.z.toFixed(1)}`);
    } else if (key === "effect") {
      if (!(s.effects ?? []).some((e) => matches(value).test(e.id))) wrong.push(`нет эффекта ${value}`);
    } else if (typeof value === "number" ? Math.abs(s[key] - value) > 0.01 : s[key] !== value) {
      wrong.push(`${key}: ждали ${value}, есть ${s[key]}`);
    }
  }
  return wrong;
}

function eventWaiter(step, verb, watch, timeoutMs) {
  const [type, read] = EVENT_VERBS[verb];
  const pattern = matches(step[verb]);
  const ordered = !UNORDERED.has(verb);
  return until(async () => {
    await watch.poll();
    const from = ordered ? watch.marks[type] ?? 0 : 0;
    const index = watch.find(type, (e) => pattern.test(read(e) ?? ""), from);
    return { ok: index >= 0, index };
  }, timeoutMs, () => `нет ${verb} «${step[verb]}» за ${timeoutMs} мс`).then(({ index }) => {
    if (ordered) watch.marks[type] = index + 1;
    return read(watch.all[index]);
  });
}

function sidebarLines(h) {
  const s = h.sidebar;
  return s ? [s.title ?? "", ...(s.lines ?? [])] : [];
}

export function displayFits(e, want) {
  const d = e.display ?? {};
  for (const [key, value] of Object.entries(want)) {
    if (["type", "name", "text", "radius", "count", "atLeast", "x", "y", "z", "limit"].includes(key)) continue;
    const have = d[key] ?? e[key];
    if (Array.isArray(value)) {
      if (!Array.isArray(have) || value.some((v, i) => Math.abs(have[i] - v) > 0.01)) return `${key}: ждали ${JSON.stringify(value)}, есть ${JSON.stringify(have)}`;
    } else if (typeof value === "number") {
      if (typeof have !== "number" || Math.abs(have - value) > 0.01) return `${key}: ждали ${value}, есть ${have}`;
    } else if (typeof value === "string") {
      if (!matches(value).test(String(have ?? ""))) return `${key}: ждали ${value}, есть ${have}`;
    } else if (have !== value) {
      return `${key}: ждали ${value}, есть ${have}`;
    }
  }
  return null;
}

async function entities(spec, displays) {
  const { type, name, text, radius = 32, x, y, z, limit = 60 } = spec;
  return player.scene({ type, name, text, radius, x, y, z, limit, displays });
}

async function perform(step, watch) {
  const timeoutMs = step.timeout ?? 8000;
  for (const verb of Object.keys(EVENT_VERBS)) if (verb in step) return eventWaiter(step, verb, watch, timeoutMs);
  if ("say" in step) {
    await player.send(step.say);
    return "";
  }
  if ("wait" in step) {
    await player.sleep(step.wait);
    return "";
  }
  if ("expect" in step) {
    const pattern = matches(step.expect);
    const hit = await until(async () => {
      await watch.poll();
      const index = watch.chat.findIndex((l, i) => i >= watch.mark && pattern.test(l));
      return { ok: index >= 0, index };
    }, timeoutMs, () => `в чате нет «${step.expect}» за ${timeoutMs} мс`);
    watch.mark = hit.index + 1;
    return watch.chat[hit.index];
  }
  if ("absent" in step) {
    await watch.poll();
    const pattern = matches(step.absent);
    const line = watch.chat.find((l) => pattern.test(l));
    if (line) throw new Error(`в чате есть то, чего быть не должно: ${line}`);
    return "";
  }
  if ("event" in step) {
    const { type, match } = step.event;
    const pattern = match ? matches(match) : null;
    await until(async () => {
      await watch.poll();
      return { ok: watch.find(type, (e) => !pattern || pattern.test(JSON.stringify(e))) >= 0 };
    }, timeoutMs, () => `нет события ${type}${match ? ` «${match}»` : ""} за ${timeoutMs} мс`);
    return "";
  }
  if ("sidebar" in step) {
    const pattern = matches(step.sidebar);
    const r = await until(async () => {
      const lines = sidebarLines(await player.hud());
      return { ok: lines.some((l) => pattern.test(l)), lines };
    }, timeoutMs, ({ lines }) => `в скорборде нет «${step.sidebar}»: ${lines.join(" | ") || "скорборда нет"}`);
    return r.lines.find((l) => pattern.test(l));
  }
  if ("tab" in step) {
    const pattern = matches(step.tab);
    await until(async () => {
      const h = await player.hud();
      const lines = [h.tabHeader ?? "", h.tabFooter ?? "", ...(h.tab ?? [])];
      return { ok: lines.some((l) => pattern.test(l)), lines };
    }, timeoutMs, ({ lines }) => `в табе нет «${step.tab}»: ${lines.slice(0, 6).join(" | ")}`);
    return "";
  }
  if ("block" in step) {
    const spec = step.block;
    const pattern = matches(spec.is);
    const r = await until(async () => {
      const b = await player.block(spec);
      return { ok: pattern.test(b.state), b };
    }, timeoutMs, ({ b }) => `блок ${spec.x} ${spec.y} ${spec.z}: ${b.state}, ждали ${spec.is}`);
    return r.b.state;
  }
  if ("entity" in step || "display" in step) {
    const display = "display" in step;
    const spec = step.entity ?? step.display;
    const wanted = spec.count ?? spec.atLeast ?? 1;
    const r = await until(async () => {
      const found = await entities(spec, display);
      const list = display ? found.entities.filter((e) => !displayFits(e, spec)) : found.entities;
      const count = list.length;
      const why = display && !count && found.entities.length ? displayFits(found.entities[0], spec) : "";
      return { ok: spec.count == null ? count >= wanted : count === wanted, count, why, list };
    }, timeoutMs, ({ count, why }) => `${display ? "визуализаторов" : "сущностей"} ${count}, ждали ${spec.count == null ? "не меньше " : ""}${wanted}${why ? ` (${why})` : ""}`);
    return `${r.count} шт.`;
  }
  if ("no_entity" in step) {
    await until(async () => {
      const found = await entities(step.no_entity, false);
      return { ok: found.total === 0, total: found.total };
    }, timeoutMs, ({ total }) => `сущностей осталось ${total}`);
    return "";
  }
  if ("var" in step || "no_var" in step) {
    const spec = step.var ?? step.no_var;
    const { name, scope = "game", equals, match } = typeof spec === "string" ? { name: spec } : spec;
    const r = await until(async () => {
      const { variables: list, truncated } = await player.variables({ scope, query: name });
      const found = list.find((v) => v.name === name);
      if ("no_var" in step) return { ok: !found && !truncated, found, truncated };
      const pattern = match ? matches(match) : null;
      const fits = found && (equals === undefined || String(found.value) === String(equals)) && (!pattern || pattern.test(String(found.value)));
      return { ok: Boolean(fits), found };
    }, timeoutMs, ({ found, truncated }) => `переменная ${name}: ${found ? `${found.value} (${found.type})` : truncated ? "под такое имя подходит слишком много, список обрезан" : "не задана"}${equals === undefined ? "" : `, ждали ${equals}`}`);
    return r.found ? `${r.found.value}` : "";
  }
  if ("goto" in step) {
    const { dx, dz, entity, ...point } = step.goto;
    const here = dx == null && dz == null ? null : await player.state();
    const target = here ? { x: here.x + (dx ?? 0), z: here.z + (dz ?? 0) } : point;
    const r = await player.goTo({ ...target, entity, sprint: step.sprint, tolerance: step.near, timeoutMs: step.timeout ?? 30000 });
    if (!r.arrived) throw new Error(`не дошёл: ${r.outcome}, осталось ${r.left}`);
    return "";
  }
  if ("look" in step) {
    await player.look(step.look);
    return "";
  }
  if ("track" in step) {
    const { jumps: allowed = 0, radius = TRACK_RADIUS, ...query } = step.track;
    const r = await player.track({ ...query, radius });
    if (r.jumps > allowed) throw new Error(`рывков ${r.jumps}, можно ${allowed}: ${JSON.stringify(r.worst[0])}`);
    return `рывков ${r.jumps}, частей ${r.tracked}, ${r.fps} кадров в секунду`;
  }
  if ("move" in step) {
    await player.hold(step.move.keys, step.move.ms ?? 500);
    return "";
  }
  if ("jump" in step) {
    await player.hold(["jump"], 150);
    return "";
  }
  if ("sneak" in step) {
    await player.hold(["sneak"], typeof step.sneak === "number" ? step.sneak : 500);
    return "";
  }
  if ("use" in step) {
    if (typeof step.use === "number") await player.holdUse(step.use);
    else await player.click("use");
    return "";
  }
  if ("attack" in step) {
    const { target } = await player.state();
    await player.click("attack", { times: typeof step.attack === "number" ? step.attack : 1 });
    return target?.kind === "entity" ? `прицел на ${target.type}` : `мимо: прицел ${target?.kind === "block" ? `на блоке ${target.block}` : "в пустоте"}`;
  }
  if ("limits" in step) {
    return (await player.limits()).split("\n").filter((line) => LOAD_LINES.test(line)).map((line) => line.replace(/^\W+/, "")).join("; ");
  }
  if ("drop" in step) {
    await player.click("drop");
    return "";
  }
  if ("hotbar" in step) {
    await player.setHotbar(step.hotbar);
    return "";
  }
  if ("respawn" in step) {
    await until(async () => ({ ok: await player.respawn() }), timeoutMs, () => "игрок не умер, возрождать некого");
    await player.sleep(500);
    return "";
  }
  if ("gui" in step) {
    const pattern = matches(step.gui);
    const r = await until(async () => {
      const g = await player.gui();
      const ok = g.open && (pattern.test(g.title ?? "") || g.items.some((i) => pattern.test(i.name)));
      return { ok, g };
    }, timeoutMs, ({ g }) => `окна «${step.gui}» нет: ${g.open ? `открыто «${g.title}»` : "ничего не открыто"}`);
    return r.g.title;
  }
  if ("click" in step) {
    const spec = typeof step.click === "number" ? { slot: step.click } : typeof step.click === "string" ? { item: step.click } : step.click;
    const g = await player.guiClick(spec);
    return g.title ?? "";
  }
  if ("close" in step) {
    await player.guiClose();
    return "";
  }
  if ("item" in step) {
    const wanted = step.exactly ?? step.count ?? 1;
    const r = await until(async () => {
      const { items } = await player.inventory();
      const count = items.filter((i) => itemMatches(i, step.item)).reduce((sum, i) => sum + i.count, 0);
      return { ok: step.exactly == null ? count >= wanted : count === wanted, count };
    }, timeoutMs, ({ count }) => `в инвентаре «${step.item}» ${count}, ждали ${step.exactly == null ? "не меньше " : ""}${wanted}`);
    return `${r.count} шт.`;
  }
  if ("no_item" in step) {
    const { items } = await player.inventory();
    const found = items.find((i) => itemMatches(i, step.no_item));
    if (found) throw new Error(`в инвентаре есть ${found.id} «${found.name}»`);
    return "";
  }
  if ("state" in step) {
    await until(async () => {
      const wrong = compare(await player.state(), step.state);
      return { ok: !wrong.length, wrong };
    }, timeoutMs, ({ wrong }) => wrong.join("; "));
    return "";
  }
  if ("java" in step) {
    const r = await post("/exec", { code: step.java, timeoutMs }, timeoutMs + 3000);
    if (!r.ok) throw new Error(firstLines(r.error, 4));
    if ("equals" in step && String(r.result) !== String(step.equals)) throw new Error(`результат ${r.result}, ждали ${step.equals}`);
    return String(r.result ?? r.out ?? "");
  }
  return "";
}

const label = (step) => {
  const { timeout, count, exactly, equals, ...rest } = step;
  return JSON.stringify(rest);
};

const shotSpec = (step) => ({ downscale: 2, ...(step.shot && typeof step.shot === "object" ? step.shot : {}) });

async function playerTrouble() {
  const s = await player.state().catch(() => null);
  if (!s?.inWorld) return " (игрока нет в мире)";
  if (s.health <= 0 || s.screen === "DeathScreen") return " (игрок мёртв)";
  return s.screen && s.screen !== "ChatScreen" ? ` (открыто окно ${s.screenTitle || s.screen})` : "";
}

const outOfBudget = (step, deadline) => {
  const left = deadline - Date.now();
  return left <= 0 || (typeof step.wait === "number" && step.wait > left);
};

export async function runScenario(steps, { settleMs = 1500, stay = false, tolerate, restart = true, budgetSeconds = DEFAULT_BUDGET_SECONDS } = {}) {
  const started = Date.now();
  const deadline = started + budgetSeconds * 1000;
  const watch = await player.Watch.start();
  const results = [];
  const shots = [];
  const warnings = [];
  let failed = null;
  const allowed = tolerate ? new RegExp(tolerate, "i") : null;
  const stopsCode = (line) => isServerFailure(line) && (isWorldStop(line) || !allowed?.test(line));
  running = true;
  try {
    if (restart) await restartWorld();
    else await switchMode("play");
    if (!restart && await inBuildMode()) warnings.push("игрок в творческом режиме: похоже, мир в режиме строительства после падения или /build, код не идёт. Перезапусти restart=true");
    await player.sleep(settleMs);
    await watch.poll();
    watch.mark = 0;
    for (const [i, step] of steps.entries()) {
      const at = Date.now();
      if (outOfBudget(step, deadline)) {
        failed = i + 1;
        results.push({ step: i + 1, ok: false, did: label(step), at: at - started, ms: 0, error: `сценарий не уместился в ${budgetSeconds} с: подними budget или гоняй долгое через script run с background` });
        break;
      }
      try {
        const note = await perform(step, watch);
        results.push({ step: i + 1, ok: true, did: label(step), at: at - started, ms: Date.now() - at, ...(note ? { note } : {}) });
        if (step.screenshot || step.shot) {
          for (const data of await player.screenshots(shotSpec(step))) shots.push({ step: i + 1, data });
        }
      } catch (e) {
        failed = i + 1;
        results.push({ step: i + 1, ok: false, did: label(step), at: at - started, ms: Date.now() - at, error: `${e.message}${await playerTrouble()}` });
        const data = await player.screenshots({ downscale: 2 }).then((list) => list[0]).catch(() => null);
        if (data) shots.push({ step: i + 1, data });
        break;
      }
      await watch.poll();
      const broke = watch.chat.find(stopsCode);
      if (broke) {
        failed = i + 1;
        results[results.length - 1].ok = false;
        results[results.length - 1].error = `код упал на сервере: ${broke}`;
        break;
      }
    }
    await player.sleep(400);
    await watch.poll();
  } finally {
    running = false;
    await player.releaseAll().catch(() => {});
    await player.respawn().catch(() => {});
    if (!stay) {
      await player.guiClose().catch(() => {});
      await switchMode("dev").catch((e) => results.push({ ok: false, did: "вернуться в /dev", error: e.message }));
    }
  }
  const errors = watch.chat.filter(isServerAlert);
  const fatal = errors.filter(stopsCode);
  return {
    ok: failed === null && !fatal.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(failed ? { failedStep: failed } : {}),
    ...(warnings.length ? { warnings } : {}),
    steps: results,
    errors,
    chat: watch.chat.slice(-40),
    seen: watch.summary(),
    shots,
  };
}
