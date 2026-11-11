import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPLY, isLimitsReport, isServerAlert, isServerFailure, isVariableList, isWorldStop, listedTotal, readableValue, serverStats } from "../src/game/replies.mjs";
import { validate } from "../src/game/scenario.mjs";
import * as scripts from "../src/game/scripts.mjs";
import { scenarioReport } from "../src/tools/code.mjs";
import { collapseEvents } from "../src/tools/game.mjs";
import { Project } from "../src/xero/core.mjs";

test("смена режима узнаётся на всех языках клиента", () => {
  for (const line of ["🔔 » Мир запущен в режиме игры", "🔔 » World started in play mode", "Світ запущено в режимі гри"]) {
    assert.match(line, REPLY.playMode);
    assert.doesNotMatch(line, REPLY.buildMode);
  }
  for (const line of ["🔔 » Мир запущен в режиме строительства", "World started in build mode", "Світ запущено в режимі будівництва"]) {
    assert.match(line, REPLY.buildMode);
    assert.doesNotMatch(line, REPLY.playMode);
  }
});

test("отказ «мир не запущен» не считается запуском", () => {
  for (const line of ["Мир не запущен в режиме игры", "The world is not running in play mode", "Світ не запущено в режимі гри"]) {
    assert.doesNotMatch(line, REPLY.playMode);
    assert.match(line, REPLY.notPlaying);
  }
});

test("просьба подождать узнаётся на всех языках", () => {
  for (const line of ["Подождите перед повторной отправкой сообщения", "Please wait before sending another message", "Зачекайте перед повторной відправкою"]) {
    assert.match(line, REPLY.slowDown);
  }
});

test("ошибки сервера узнаются на всех языках", () => {
  const failures = [
    "❌ Ошибка Действие Проход по списку остановило строку кода из-за ошибки:",
    "Action Repeat stopped a line of code due to an error:.",
    "Дія Повтор зупинила рядок коду через помилку:",
    "Function with these parameters not found",
    'Expected argument "x" with type Number but received Text',
  ];
  for (const line of failures) {
    assert.equal(isServerFailure(line), true, line);
    assert.equal(isServerAlert(line), true, line);
  }
  assert.equal(isServerFailure("Action Wait caused a warning:."), false);
  assert.equal(isServerAlert("Action Wait caused a warning:."), true);
});

test("ошибки сервера нового вида (09.11.2026) узнаются", () => {
  const failures = [
    "✕ ОШИБКА\nСтрока кода остановлена из-за ошибки\nДействие: Расширить меню\nfromIndex: 0, toIndex: 18, size: 0",
    "ОШИБКА",
    "│ ОШИБКА",
    "Строка кода остановлена из-за ошибки",
    "Code line was stopped due to an error:",
  ];
  for (const line of failures) {
    assert.equal(isServerFailure(line), true, line);
    assert.equal(isServerAlert(line), true, line);
    assert.equal(isWorldStop(line), false, line);
  }
  for (const line of ["КРИТИЧЕСКАЯ ОШИБКА\nВыполнение кода остановлено из-за ошибки", "Выполнение кода остановлено из-за ошибки",
    "☠ Критическая ошибка Выполнение кода было остановлено из-за ошибки:"]) {
    assert.equal(isWorldStop(line), true, line);
    assert.equal(isServerFailure(line), true, line);
  }
  const live = "┌\n│ ❌ ОШИБКА\n│ Строка кода остановлена из-за ошибки\n│ Действие: Установить блок\n"
    + "│ Ожидал аргумент \"Блок\" с типом Блок, но получил Текст\n└";
  assert.equal(isServerFailure(live), true);
  assert.equal(isWorldStop(live), false);
  assert.equal(isVariableList(live), false);
  const warning = "ПРЕДУПРЕЖДЕНИЕ\nДействие вызвало предупреждение";
  assert.equal(isServerAlert(warning), true);
  assert.equal(isServerFailure(warning), false);
  assert.equal(isServerAlert("в чате пишут про ошибку и предупреждение"), false);
});

test("список переменных узнаётся по рамке, а не по заголовку", () => {
  const russian = "┌───── Игровые переменные (16) ───── │ 1. b_mode [❌] └── ◀ 1 2 ▶ ──";
  const english = "┌──────────── Game Variables ───────────── │ 1. b_mode [❌] └── ◀ 1 ▶ ──";
  assert.equal(isVariableList(russian), true);
  assert.equal(isVariableList(english), true);
  assert.equal(listedTotal(russian), 16);
  assert.ok(Number.isNaN(listedTotal(english)));
  assert.equal(isServerAlert(russian), false);
});

test("пустой список переменных не считается молчанием сервера", () => {
  for (const line of ["Переменные отсутствуют или не загружены", "No variables found or not loaded", "Змінні відсутні або не завантажені"]) {
    assert.match(line, REPLY.noVariables);
  }
});

test("отчёт о лимитах отличается от списка переменных", () => {
  const report = "┌─── Limits ───\n│ blockChangesCount: 0/200000";
  assert.equal(isLimitsReport(report), true);
  assert.equal(isVariableList(report), false);
});

test("значение места читается как код", () => {
  const raw = "Location{world=CraftWorld{key=minecraft:world_1a2b3c4d},x=8.826775579283302,y=4.0,z=-9.597255449404834,pitch=-13.084429,yaw=27.600018}";
  assert.equal(readableValue(raw), "loc(8.827, 4, -9.597, 27.6, -13.084)");
  assert.equal(readableValue("обычный текст"), "обычный текст");
});

test("пинг и онлайн читаются на всех языках", () => {
  assert.deepEqual(serverStats({ tabFooter: "Онлайн: 208 | Миров онлайн: 60 \n Пинг: 112 | TPS: 20.00" }), { tps: 20, ping: 112, online: 208 });
  assert.deepEqual(serverStats({ tabFooter: "Online: 9 | Worlds: 2 \n Ping: 30 | TPS: 19.5" }), { tps: 19.5, ping: 30, online: 9 });
});

test("сценарий принимает замер движения", () => {
  assert.doesNotThrow(() => validate([{ track: { name: "part", ms: 2000, jumps: 1 } }]));
});

test("отчёт сценария короткий, а упавший шаг виден целиком", () => {
  const r = scenarioReport({
    ok: false,
    seconds: 4,
    failedStep: 2,
    steps: [
      { step: 1, ok: true, did: '{"say":"@boss"}', at: 4100, ms: 5 },
      { step: 2, ok: false, did: '{"expect":"Победа"}', at: 5200, ms: 800, error: "в чате нет" },
      { ok: false, did: "вернуться в /dev", error: "режим не включился" },
    ],
    chat: ["раз", "раз", "❌ ошибка", "два"],
    errors: ["❌ ошибка", "❌ ошибка"],
    seen: {},
    shots: [{ data: "x" }],
  });
  assert.deepEqual(r.steps, ["1 ✓ 4.1с say:@boss", "2 ✗ 5.2с expect:Победа: в чате нет", "· ✗ 0.0с вернуться в /dev: режим не включился"]);
  assert.deepEqual(r.errors, ["❌ ошибка"]);
  assert.deepEqual(r.chat, ["раз", "два"]);
  assert.equal(r.shots, undefined);
});

test("повторы событий сворачиваются", () => {
  const list = [
    { seq: 1, t: 1, type: "health", health: 20 },
    { seq: 2, t: 2, type: "health", health: 20 },
    { seq: 3, t: 3, type: "health", health: 19 },
  ];
  assert.deepEqual(collapseEvents(list), [{ type: "health", health: 20, t: 1, times: 2 }, { type: "health", health: 19, t: 3 }]);
});

test("ожидание фоновой задачи без задач объясняет, что не так", async () => {
  await assert.rejects(() => scripts.waitFor(987654), /нет задачи/);
});

test("файлы *.debug.xero идут только в отладочную сборку", () => {
  const folder = mkdtempSync(join(tmpdir(), "xero-debug-"));
  writeFileSync(join(folder, "game.xero"), 'when player_join {\n    send_message("бой")\n}\n');
  writeFileSync(join(folder, "cheats.debug.xero"), 'when player_chat {\n    send_message("чит")\n}\n');
  const handlers = (debug) => JSON.parse(new Project({ path: folder, debug }).build().module).handlers.length;
  assert.equal(handlers(false), 1);
  assert.equal(handlers(true), 2);
  assert.match(readFileSync(join(folder, "game.xero"), "utf8"), /бой/);
});
