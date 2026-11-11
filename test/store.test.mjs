import assert from "node:assert/strict";
import { test } from "node:test";
import { Knowledge } from "../src/knowledge/store.mjs";
import { tagsOf } from "../src/knowledge/tags.mjs";

const k = new Knowledge();

test("база собрана из всех модулей", () => {
  const s = k.stats();
  assert.ok(s.files >= 1000);
  assert.ok(s.chunks >= 5000);
  assert.ok(s.idioms > 50);
  assert.ok(s.assoc > 1000);
});

test("слова связаны с действиями из самих модулей", () => {
  const found = k.assoc("кейс").map(([symbol]) => symbol);
  assert.ok(found.includes("spawn_item_display"));
});

test("поиск по-русски находит действие по смыслу", () => {
  const names = k.lookup("голограмма", { limit: 12 }).map((r) => r.name);
  assert.ok(names.includes("spawn_text_display") || names.includes("display_hologram"));
});

test("карточка знает типичные значения аргументов", () => {
  const { fill, values, next } = k.learned("set_display_scale");
  assert.ok(fill.some((f) => f.arg === "scale_vector"));
  assert.ok(values.some((v) => v.value.startsWith("vec(")));
  assert.ok(Array.isArray(next));
});

test("примеры не повторяют одинаковый код", () => {
  const rows = k.searchChunks("выдать предмет", { limit: 6 });
  assert.equal(new Set(rows.map((r) => r.shape)).size, rows.length);
});

test("поиск примеров по приёму", () => {
  const rows = k.searchChunks("", { tag: "визуализатор", limit: 3 });
  assert.equal(rows.length, 3);
  for (const r of rows) assert.match(r.tags, /визуализатор/);
});

test("список модулей фильтруется по приёму", () => {
  const rows = k.modules({ tag: "частицы", limit: 5 });
  assert.equal(rows.length, 5);
  assert.ok(rows[0].installs >= rows[4].installs);
});

test("разделы руководства ищутся по смыслу", () => {
  const hits = k.guideSearch("кулдаун на предмет");
  assert.ok(hits.length > 0);
  assert.ok(hits[0].score >= hits[hits.length - 1].score);
});

test("приём определяется по именам", () => {
  assert.deepEqual(tagsOf(["spawn_text_display"]).sort(), ["визуализатор", "голограмма"].sort());
  assert.ok(tagsOf(["filter_by_raycast"]).includes("луч"));
  assert.deepEqual(tagsOf(["send_message"]), []);
});
