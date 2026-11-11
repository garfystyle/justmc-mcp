import assert from "node:assert/strict";
import { test } from "node:test";
import { Project, position } from "../src/xero/core.mjs";
import { loadReference } from "../src/knowledge/reference.mjs";
import { stem, tokens } from "../src/knowledge/stem.mjs";
import { Knowledge } from "../src/knowledge/store.mjs";

test("формы одного слова дают одну основу", () => {
  assert.equal(stem("предметы"), stem("предмет"));
  assert.equal(stem("игроку"), stem("игрок"));
});

test("составные имена режутся на части", () => {
  assert.deepEqual(tokens("send_message"), ["send", "message"]);
});

test("справочник разобран полностью", () => {
  const all = loadReference();
  const count = (kind) => all.filter((r) => r.kind === kind).length;
  assert.ok(count("action") > 800);
  assert.ok(count("condition") > 100);
  assert.ok(count("event") > 200);
  assert.ok(count("value") > 200);
  assert.ok(all.some((r) => r.name === "give_items" && r.body.includes("items")));
});

test("ошибка указывает строку и столбец", () => {
  const { ok, diagnostics } = new Project({ code: 'when player_join {\n    send_mesage("x")\n}\n' }).check();
  assert.equal(ok, false);
  assert.equal(diagnostics[0].line, 2);
  assert.equal(diagnostics[0].column, 5);
  assert.match(diagnostics[0].hint, /send_message/);
});

test("поиск понимает обычные глаголы, а не только подписи блоков", () => {
  const k = new Knowledge();
  const first = (query, count = 6) => k.lookup(query, { limit: count }).map((r) => r.name);
  assert.ok(first("поставить блок").includes("set_block"));
  assert.ok(first("игрок умер").includes("player_death"));
  assert.ok(first("игрок прыгнул").includes("player_jump"));
  assert.ok(first("подождать").includes("wait"));
  assert.ok(first("показать тайтл").includes("send_title"));
});

test("плейсхолдер находится по имени без скобок", () => {
  assert.deepEqual(new Knowledge().entries("%index").map((r) => r.name), ["%index()"]);
});

test("позиция считается с единицы", () => {
  assert.deepEqual(position("a\nbc", 3), { line: 2, column: 2 });
});
