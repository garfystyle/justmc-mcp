import assert from "node:assert/strict";
import { test } from "node:test";
import { Project } from "../src/xero/core.mjs";
import { lint } from "../src/xero/lint.mjs";

const advice = (code) => {
  const built = new Project({ code }).build();
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  return lint(built.module).map((a) => a.text).join("\n");
};

test("компилятор предупреждает о голом атрибуте и параметре в имени", () => {
  const warnings = (code) => new Project({ code }).build().diagnostics.map((d) => d.message).join("\n");
  assert.match(warnings("when player_join {\n    player.set_attribute(1, attribute_type: movement_speed)\n}\n"), /Enum MOVEMENT_SPEED/);
  assert.match(warnings("func f(who) {\n    game `a %var_local(who)` = 1\n}\nwhen player_join {\n    f(\"x\")\n}\n"), /%var_line\(who\)/);
});

test("ограниченный while не пугают обрывом", () => {
  const text = advice("when player_join {\n    i = 0\n    while i < 3 {\n        i += 1\n    }\n}\n");
  assert.match(text, /while без wait/);
  assert.doesNotMatch(text, /сервер оборвёт его ошибкой/);
});

test("цикл без wait виден", () => {
  assert.match(advice("process a() {\n    forever {\n        x = 1\n    }\n}\n"), /цикл без wait/);
});

test("цикл с wait или вызовом функции не трогаем", () => {
  assert.equal(advice("process a() {\n    forever {\n        wait(1)\n    }\n}\n"), "");
  assert.equal(advice("func f() {\n    wait(1)\n}\nprocess a() {\n    forever {\n        f()\n    }\n}\n"), "");
});

test("обычный счётный цикл без wait не считается вечным", () => {
  assert.equal(advice('when player_join {\n    repeat 3 {\n        send_message("x")\n    }\n}\n'), "");
});

test("wait в частом событии виден", () => {
  assert.match(advice("when player_move {\n    wait(5)\n}\n"), /частом событии/);
  assert.equal(advice("when player_join {\n    wait(5)\n}\n"), "");
});

test("отмена после wait видна", () => {
  assert.match(advice("when player_chat {\n    wait(1)\n    cancel_event()\n}\n"), /cancel_event после wait/);
  assert.equal(advice("when player_chat {\n    cancel_event()\n    wait(1)\n}\n"), "");
});

test("настройка визуализатора без цели видна, @last и выборка проходят", () => {
  const spawn = 'spawn_text_display(value.location, "t", "hi")';
  assert.match(advice(`when player_join {\n    ${spawn}\n    set_display_scale(vec(1, 1, 1))\n    entity_by_name("t")\n    @current entity.remove()\n}\n`), /без цели/);
  assert.doesNotMatch(advice(`when player_join {\n    ${spawn}\n    @last set_display_scale(vec(1, 1, 1))\n    entity_by_name("t")\n    @current entity.remove()\n}\n`), /без цели/);
  assert.doesNotMatch(advice(`when player_join {\n    ${spawn}\n    last_entity()\n    set_display_scale(vec(1, 1, 1))\n    @current entity.remove()\n}\n`), /без цели/);
});

test("визуализаторы без уборки видны", () => {
  assert.match(advice('when player_join {\n    spawn_text_display(value.location, "t", "hi")\n}\n'), /нигде не удаляются/);
});
