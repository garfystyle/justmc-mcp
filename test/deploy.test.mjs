import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.JUSTMC_WORKSPACE = mkdtempSync(join(tmpdir(), "justmc-world-"));

const { fingerprint, merge, readWorldFile, saveWorldFile, worldOf } = await import("../src/game/deploy.mjs");
const { validate } = await import("../src/game/scenario.mjs");

const line = (event, text, position) => ({
  type: "event",
  event,
  position,
  operations: [{ action: "player_send_message", values: [{ name: "messages", value: { type: "text", text } }] }],
});
const fn = (name, position, body = "x") => ({ type: "function", name, position, operations: [{ action: body }] });
const textOf = (h) => h.operations[0].values[0].value.text;

test("своя прошлая версия заменяется, чужие строки остаются", () => {
  const old = line("player_join", "старая", 0);
  const foreign = line("player_quit", "чужая", 1);
  const r = merge(new Set([fingerprint(old)]), [old, foreign], [line("player_join", "новая", 0)]);
  assert.equal(r.kept, 1);
  assert.deepEqual(r.handlers.map(textOf).sort(), ["новая", "чужая"]);
});

test("новые строки не занимают номера чужих", () => {
  const r = merge(new Set(), [line("player_quit", "чужая", 0)], [line("player_join", "а", 0), line("player_chat", "б", 1)]);
  const positions = r.handlers.map((h) => h.position);
  assert.equal(new Set(positions).size, positions.length);
});

test("одноимённая функция заменяется, а не задваивается", () => {
  const r = merge(new Set(), [fn("f", 0, "старое")], [fn("f", 0, "новое")]);
  assert.equal(r.handlers.length, 1);
  assert.equal(r.handlers[0].operations[0].action, "новое");
});

test("замена чужой функции не проходит молча", () => {
  const foreign = fn("hurt_near", 0, "чужое");
  assert.deepEqual(merge(new Set(), [foreign], [fn("hurt_near", 0, "новое")]).clashes, ["function hurt_near"]);
  assert.deepEqual(merge(new Set([fingerprint(foreign)]), [foreign], [fn("hurt_near", 0, "новое")]).clashes, []);
});

test("id мира берётся из измерения в любом режиме", () => {
  assert.equal(worldOf("minecraft:world_1a2b3c4d-0000-4000-8000-00000000abcd_creativeplus_editor"), "1a2b3c4d");
  assert.equal(worldOf("minecraft:world_1a2b3c4d-0000-4000-8000-00000000abcd"), "1a2b3c4d");
  assert.equal(worldOf("minecraft:overworld"), null);
});

test("чужая строка того же события даёт предупреждение", () => {
  const r = merge(new Set(), [line("player_join", "чужая", 0)], [line("player_join", "моя", 0)]);
  assert.deepEqual(r.twins, ["player_join"]);
});

test("отпечаток не зависит от номера строки и кодировки предмета", () => {
  const make = (position, item) => ({
    type: "event",
    event: "e",
    position,
    operations: [{ action: "a", values: [{ name: "i", value: { type: "item", item } }] }],
  });
  assert.equal(fingerprint(make(0, "AAA")), fingerprint(make(7, "BBB")));
});

test("сценарий без глагола не проходит проверку", () => {
  assert.throws(() => validate([{ say: "/x" }, { nonsense: 1 }]), /шаг 2/);
  assert.doesNotThrow(() => validate([{ expect: "x", timeout: 100 }, { item: "stone", count: 2 }]));
});

test("код мира читается только из файла", () => {
  assert.throws(() => readWorldFile("нет-такого"), /Мир из игры не читается/);
  const handlers = [fn("a", 3), fn("b", 7)];
  saveWorldFile("мир", handlers);
  assert.deepEqual(readWorldFile("мир"), handlers);
});
