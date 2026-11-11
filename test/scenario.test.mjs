import assert from "node:assert/strict";
import { test } from "node:test";
import { displayFits, validate } from "../src/game/scenario.mjs";
import { Watch } from "../src/game/player.mjs";
import { drawRegion } from "../src/tools/game.mjs";

test("новые глаголы сценария принимаются", () => {
  assert.doesNotThrow(() => validate([
    { actionbar: "x" }, { title: "x" }, { subtitle: "x" }, { bossbar: "x" }, { sidebar: "x" }, { tab: "x" },
    { sound: "levelup" }, { particle: "flame" }, { effect: "speed" }, { block: { x: 0, y: 0, z: 0, is: "stone" } },
    { entity: { type: "zombie" } }, { no_entity: { type: "zombie" } }, { display: { type: "text_display" } },
    { event: { type: "teleport" } }, { shot: true },
  ]));
});

test("состояние визуализатора сравнивается по полям", () => {
  const e = { display: { scale: [2, 2, 2], translation: [0, 0.5, 0], billboard: "center", text: "Привет", lineWidth: 200 } };
  assert.equal(displayFits(e, { type: "text_display", scale: [2, 2, 2], billboard: "center", text: "Привет" }), null);
  assert.match(displayFits(e, { scale: [1, 1, 1] }), /scale/);
  assert.match(displayFits(e, { billboard: "fixed" }), /billboard/);
  assert.equal(displayFits(e, { lineWidth: 200 }), null);
  assert.match(displayFits(e, { lineWidth: 100 }), /lineWidth/);
});

test("отчёт собирает, что увидел клиент", () => {
  const w = new Watch();
  w.all = [
    { type: "sound", id: "entity.player.levelup" },
    { type: "sound", id: "entity.player.levelup" },
    { type: "particle", id: "flame", count: 5 },
    { type: "particle", id: "flame", count: 3 },
    { type: "title", text: "Победа" },
    { type: "title", text: "Победа" },
    { type: "actionbar", text: "Монет: 5" },
    { type: "entity_add", entity: "text_display" },
    { type: "block", block: "stone" },
    { type: "effect", id: "minecraft:speed" },
  ];
  const s = w.summary();
  assert.deepEqual(s.sounds, { "entity.player.levelup": 2 });
  assert.deepEqual(s.particles, { flame: 8 });
  assert.deepEqual(s.title, ["Победа"]);
  assert.deepEqual(s.actionbar, ["Монет: 5"]);
  assert.deepEqual(s.spawned, { text_display: 1 });
  assert.deepEqual(s.blocks, { stone: 1 });
  assert.deepEqual(s.effects, ["speed"]);
});

test("события ищутся с заданного места", () => {
  const w = new Watch();
  w.all = [{ type: "sound", id: "a" }, { type: "sound", id: "b" }, { type: "sound", id: "a" }];
  assert.equal(w.find("sound", (e) => e.id === "a"), 0);
  assert.equal(w.find("sound", (e) => e.id === "a", 1), 2);
  assert.equal(w.find("sound", (e) => e.id === "c"), -1);
});

test("область рисуется послойно, воздух точками", () => {
  const out = drawRegion({ origin: [0, 5, 0], size: [2, 2, 1], palette: ["air", "stone"], cells: "1,0,0,0," });
  assert.match(out, /y=5\n/);
  assert.doesNotMatch(out, /y=6/);
  assert.match(out, /a=stone/);
  assert.match(out, /a\./);
});
