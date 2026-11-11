const ENDLESS = new Set(["repeat_forever", "repeat_while"]);
const FREQUENT = new Set(["player_move", "player_rotate", "player_vehicle_move", "player_fail_move"]);
const DISPLAY_SPAWN = /^game_spawn_(?:text|block|item)_display$/;
const DISPLAY_SETTING = /^entity_(?:set|reset)_(?:text_|block_|item_)?display_/;
const WAITS = new Set(["control_wait", "call_function", "start_process"]);

const handlerName = (h) => (h.type === "event" ? `when ${h.event}` : `${h.type === "process" ? "process" : "func"} ${h.name}`);

function contains(operations, test) {
  for (const op of operations ?? []) {
    if (test(op) || contains(op.operations, test)) return true;
  }
  return false;
}

function walk(operations, visit, selected = false) {
  let picked = selected;
  for (const op of operations ?? []) {
    visit(op, picked);
    if (op.action?.startsWith("select_") && op.action !== "select_reset") picked = true;
    if (op.action === "select_reset") picked = selected;
    walk(op.operations, visit, picked);
  }
}

function endless(h, out) {
  walk(h.operations, (op) => {
    if (!ENDLESS.has(op.action) || contains(op.operations, (o) => WAITS.has(o.action))) return;
    out.push({
      where: handlerName(h),
      text: op.action === "repeat_forever"
        ? "цикл без wait: сервер оборвёт его ошибкой «Обнаружен бесконечный цикл без задержки». Добавь wait в тело"
        : "while без wait: идёт за один тик. Короткий цикл с понятным концом можно оставить, а долгий сервер оборвёт, в него нужен wait",
    });
  });
}

function frequent(h, out) {
  if (h.type !== "event" || !FREQUENT.has(h.event)) return;
  for (const op of h.operations ?? []) {
    if (op.action === "control_wait" || op.action === "start_process") {
      out.push({ where: handlerName(h), text: "wait или start в частом событии: каждое срабатывание плодит копию, сервер ответит лимитом ожиданий или процессов. Держи один цикл в процессе" });
      return;
    }
  }
}

function lateCancel(h, out) {
  if (h.type !== "event") return;
  let waited = false;
  for (const op of h.operations ?? []) {
    if (op.action === "control_wait") waited = true;
    if (op.action === "game_cancel_event" && waited) {
      out.push({ where: handlerName(h), text: "cancel_event после wait: событие уже прошло. Ставь отмену первой строкой" });
      return;
    }
  }
}

function untargeted(h, out) {
  if (h.type !== "event") return;
  let spawned = false;
  walk(h.operations, (op, selected) => {
    if (DISPLAY_SPAWN.test(op.action ?? "")) spawned = true;
    if (spawned && DISPLAY_SETTING.test(op.action ?? "") && !op.selection && !selected) {
      out.push({ where: handlerName(h), text: `${op.action.replace(/^entity_/, "")} без цели идёт игроку события, а не визуализатору. Нужен @last или выборка` });
      spawned = false;
    }
  });
}

function leftovers(handlers, out) {
  const all = handlers.flatMap((h) => h.operations ?? []);
  const spawns = contains(all, (op) => DISPLAY_SPAWN.test(op.action ?? ""));
  const removes = contains(all, (op) => op.action === "entity_remove");
  if (spawns && !removes) {
    out.push({ where: "весь код", text: "визуализаторы создаются, но нигде не удаляются: они переживают перезапуск мира и копятся. Убирай их по имени или тегу, хотя бы в world_start" });
  }
}

export function lint(module) {
  const handlers = (typeof module === "string" ? JSON.parse(module) : module).handlers ?? [];
  const out = [];
  for (const h of handlers) {
    endless(h, out);
    frequent(h, out);
    lateCancel(h, out);
    untargeted(h, out);
  }
  leftovers(handlers, out);
  return out;
}
