import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const TOKEN = "fake-token";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const game = {
  gamemode: "ADVENTURE",
  mode: "dev",
  sent: [],
  events: [],
  answer: () => [],
};

let seq = 0;
const nextEvents = () => {
  const list = game.events;
  game.events = [];
  return list;
};

function say(text) {
  game.sent.push(text);
  for (const event of game.answer(text)) {
    seq++;
    game.events.push({ seq, t: Date.now(), type: "chat", ...event });
  }
}

const reply = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

const fakeAgent = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const path = request.url.split("?")[0];
    if (path === "/ping") return reply(response, 200, { ok: true, result: {} });
    if (path === "/state") return reply(response, 200, { ok: true, result: { inWorld: true, mode: game.mode, gamemode: game.gamemode } });
    if (path === "/events") return reply(response, 200, { ok: true, result: { head: seq, events: nextEvents() } });
    if (path === "/respawn") return reply(response, 200, { ok: true, result: false });
    if (path === "/say") {
      say(JSON.parse(body).text);
      return reply(response, 200, { ok: true, result: "ok" });
    }
    return reply(response, 200, { ok: false, error: `нет ${path}` });
  });
});

let modes;
let player;

before(async () => {
  await new Promise((resolve) => fakeAgent.listen(0, "127.0.0.1", resolve));
  const workspace = mkdtempSync(join(tmpdir(), "justmc-fake-"));
  mkdirSync(join(workspace, "agent"), { recursive: true });
  const hash = createHash("sha1").update(readFileSync(join(ROOT, "vendor", "agent.jar"))).digest("hex").slice(0, 12);
  writeFileSync(join(workspace, "agent", "session.json"), JSON.stringify({ port: fakeAgent.address().port, token: TOKEN, version: "fake", hash }));
  process.env.JUSTMC_WORKSPACE = workspace;
  modes = await import("../src/game/modes.mjs");
  player = await import("../src/game/player.mjs");
});

after(() => {
  fakeAgent.close();
  fakeAgent.closeAllConnections();
});

beforeEach(() => {
  game.sent = [];
  game.events = [];
  game.mode = "play";
  game.gamemode = "ADVENTURE";
});

const serverLike = (lines) => (text) => {
  if (text === "/build") game.gamemode = "CREATIVE";
  if (text === "/play") game.gamemode = "ADVENTURE";
  return (lines[text] ?? []).map((line) => ({ text: line }));
};

test("английский клиент: мир перезапускается, /play уходит один раз", { timeout: 15000 }, async () => {
  game.answer = serverLike({ "/build": ["🔔 » World started in build mode"], "/play": ["🔔 » World started in play mode"] });
  await modes.restartWorld();
  assert.deepEqual(game.sent, ["/build", "/play"]);
});

test("незнакомый язык: хватает состояния игрока", { timeout: 15000 }, async () => {
  game.answer = serverLike({ "/build": ["Świat w trybie budowania"], "/play": ["Świat w trybie gry"] });
  await modes.restartWorld();
  assert.deepEqual(game.sent, ["/build", "/play"]);
});

test("сервер просит подождать: команда уходит ещё раз", { timeout: 20000 }, async () => {
  let refused = false;
  game.answer = (text) => {
    if (text === "/build" && !refused) {
      refused = true;
      return [{ text: "Please wait before sending another message" }];
    }
    return serverLike({ "/build": ["World started in build mode"], "/play": ["World started in play mode"] })(text);
  };
  await modes.restartWorld();
  assert.deepEqual(game.sent, ["/build", "/build", "/play"]);
});

const listing = (name, value, tail = "") => ({
  text: `┌──── Game Variables ──── │ 1. ${name} [❌]${tail}`,
  parts: [{ text: name, hover: `{type: number, '${value}&Double'}` }],
});

test("переменные читаются без числа в заголовке", { timeout: 15000 }, async () => {
  game.answer = () => [listing("boss_health", "7.0")];
  const { total, variables } = await player.variables({ query: "boss_health" });
  assert.equal(total, 1);
  assert.deepEqual(variables, [{ name: "boss_health", type: "number", value: 7 }]);
});

test("нет переменных: это ответ, а не молчание", { timeout: 15000 }, async () => {
  game.answer = () => [{ text: "No variables found or not loaded" }];
  assert.deepEqual(await player.variables({ query: "missing" }), { total: 0, variables: [] });
});

test("вне режима игры ошибка говорит, что не так", { timeout: 15000 }, async () => {
  game.answer = () => [{ text: "The world is not running in play mode" }];
  await assert.rejects(() => player.variables({}), /только в режиме игры/);
});

test("параллельные запросы не перепутывают ответы", { timeout: 20000 }, async () => {
  game.answer = (text) => {
    const name = text.split(" ").at(-1);
    return [listing(name, name === "first_value" ? "1.0" : "2.0")];
  };
  const [first, second] = await Promise.all([
    player.variables({ query: "first_value" }),
    player.variables({ query: "second_value" }),
  ]);
  assert.equal(first.variables[0].name, "first_value");
  assert.equal(second.variables[0].name, "second_value");
});

test("список на нескольких страницах собирается целиком", { timeout: 20000 }, async () => {
  game.answer = (text) => {
    if (text.startsWith("/next")) return [{ text: "┌── Игровые переменные (2) ── │ 2. second [❌]", parts: [{ text: "second", hover: "{type: number, '2.0&Double'}" }] }];
    return [{
      text: "┌── Игровые переменные (2) ── │ 1. first [❌] └── ◀ 1 2 ▶ ──",
      parts: [{ text: "first", hover: "{type: number, '1.0&Double'}" }, { text: "▶", run: "/next 2" }],
    }];
  };
  const { total, variables } = await player.variables({});
  assert.equal(total, 2);
  assert.deepEqual(variables.map((v) => v.name), ["first", "second"]);
});

test("списки и словари читаются в той форме, что шлёт сервер", { timeout: 15000 }, async () => {
  const page = { text: "┌── Игровые переменные (4) ──", parts: [
    { text: "empty", hover: "empty\n[]" },
    { text: "list", hover: "list\n[{type: number, '1.0&Double'}, {type: text, 'two&TextValue'}, {type: vector, '1.0,0.0,0.0&Vector'}]" },
    { text: "map", hover: "map\n{{type: text, 'a&TextValue'}={type: number, '1.0&Double'}}" },
    { text: "number", hover: "number\n{type: number, '8.5&Double'}" },
    { text: "◀", hover: "Перейти на предыдущую страницу", run: "/same" },
    { text: "▶", hover: "Перейти на следующую страницу", run: "/same" },
    { text: "[❌]", hover: "Нажмите, чтобы удалить" },
  ] };
  game.answer = () => [page];
  const { total, variables, truncated } = await player.variables({});
  assert.equal(total, 4);
  assert.equal(truncated, undefined);
  assert.deepEqual(variables, [
    { name: "empty", type: "list", value: "[]" },
    { name: "list", type: "list", value: "[1, two, vec(1, 0, 0)]" },
    { name: "map", type: "map", value: "{a=1}" },
    { name: "number", type: "number", value: 8.5 },
  ]);
});

test("обрезанный список сам об этом говорит", { timeout: 40000 }, async () => {
  let page = 0;
  game.answer = () => {
    page += 1;
    return [{ text: "┌── Игровые переменные (263) ──", parts: [{ text: `v${page}`, hover: `v${page}\n{type: number, '1.0&Double'}` }, { text: "▶", run: "/next" }] }];
  };
  const { total, variables, truncated } = await player.variables({});
  assert.equal(total, 263);
  assert.equal(variables.length, 5);
  assert.equal(truncated, true);
});

test("глобальный чат не попадает в ответы", { timeout: 15000 }, async () => {
  const watch = await player.Watch.start();
  game.events.push({ seq: ++seq, type: "chat", text: "[!] кто-то: привет" }, { seq: ++seq, type: "chat", text: "⏵ кто-то" }, { seq: ++seq, type: "chat", text: "Ответ мира" });
  await watch.poll();
  assert.deepEqual(watch.chat, ["Ответ мира"]);
});
