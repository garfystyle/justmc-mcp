import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "../src/paths.mjs";

const TOOLS = ["ask", "guide", "find", "examples", "check", "test", "deploy", "world", "player", "see", "screenshot", "execute", "script"];
let client;

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { error: Boolean(r.isError), text: r.content.map((c) => c.text ?? "").join("\n") };
};

before(async () => {
  client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "src", "index.mjs")], stderr: "ignore" }));
});

after(async () => {
  await client.close();
});

test("все инструменты на месте, у каждого есть описание", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
  for (const t of tools) assert.ok(t.description.length > 20, t.name);
});

test("сервер сам объясняет, как работать", () => {
  assert.match(client.getInstructions(), /Xero/);
  assert.match(client.getInstructions(), /justmc/);
});

test("ask отдаёт и руководство, и имена, и код", async () => {
  const r = await call("ask", { query: "голограмма над игроком" });
  assert.equal(r.error, false);
  assert.match(r.text, /### Имена/);
  assert.match(r.text, /```kotlin/);
});

test("guide без темы отдаёт список", async () => {
  const r = await call("guide");
  assert.match(r.text, /start/);
  assert.match(r.text, /displays|combat/);
});

test("неизвестная тема объясняет, какие есть", async () => {
  const r = await call("guide", { topic: "нет-такой" });
  assert.equal(r.error, true);
  assert.match(r.text, /Есть:/);
});

test("карточка действия содержит то, что узнано из модулей", async () => {
  const r = await call("find", { query: "set_display_scale", full: true });
  assert.match(r.text, /Как заполняют в модулях/);
  assert.match(r.text, /scale_vector/);
});

test("чистый код собирается, с опечаткой подсказывает", async () => {
  const good = await call("check", { code: 'when player_join {\n    send_message("x")\n}\n' });
  assert.match(good.text, /^Собирается/);
  const bad = await call("check", { code: 'when player_join {\n    send_mesage("x")\n}\n' });
  assert.match(bad.text, /Не собирается/);
  assert.match(bad.text, /send_message/);
});

test("правка компилятора применяется по просьбе", async () => {
  const r = await call("check", { code: 'when player_join {\n    send_mesage("x")\n}\n', fix: true });
  assert.match(r.text, /Правок применено/);
  assert.match(r.text, /send_message\("x"\)/);
});

test("примеры ищутся по приёму и список модулей строится", async () => {
  const tag = await call("examples", { tag: "визуализатор", limit: 2 });
  assert.match(tag.text, /```kotlin/);
  const list = await call("examples", { list: true, tag: "частицы", limit: 3 });
  assert.equal(list.text.split("\n").length, 3);
});

test("руководство отдаётся и ресурсами", async () => {
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "justmc://guide/start"));
});
