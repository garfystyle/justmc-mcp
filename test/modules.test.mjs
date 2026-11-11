import assert from "node:assert/strict";
import { test } from "node:test";
import { functionDocs, moduleText, moduleTitle } from "../src/knowledge/modules.mjs";

test("название модуля без цветов и версии", () => {
  assert.equal(moduleTitle({ displayName: "&#ff6060Оружие [1.2]\\n&fописание" }), "Оружие");
});

test("описание модуля строками через точку", () => {
  assert.equal(moduleText({ displayName: "&aОружие\\n\\n&fописание" }), "Оружие · описание");
});

test("описание функции из старого поля и из значений", () => {
  const docs = functionDocs(JSON.stringify({
    handlers: [
      { type: "function", name: "old", description: { type: "array", values: [{ type: "text", text: "&aСтарое" }] } },
      { type: "function", name: "new", values: [{ name: "description", value: { type: "array", values: [{ type: "text", text: "Новое" }] } }] },
      { type: "event", event: "player_join" },
    ],
  }));
  assert.deepEqual([...docs], [["old", "Старое"], ["new", "Новое"]]);
});

test("файл с Infinity не роняет разбор описаний", () => {
  assert.equal(functionDocs('{"handlers":[{"x":Infinity}]}').size, 0);
});
