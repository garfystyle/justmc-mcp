import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, GUIDE } from "../src/paths.mjs";
import { compile, deploy, open } from "../src/game/deploy.mjs";
import { toDev } from "../src/game/modes.mjs";
import { runScenario, validate } from "../src/game/scenario.mjs";
import { Knowledge } from "../src/knowledge/store.mjs";
import { reviewFile } from "../src/xero/style.mjs";

const args = process.argv.slice(2);
const inGame = args.includes("--game");
const only = args.find((a) => !a.startsWith("--"));
const k = new Knowledge();
const report = join(DATA, "guide-verify.json");
const fresh = args.includes("--fresh");
const results = existsSync(report) && inGame && !fresh ? JSON.parse(readFileSync(report, "utf8")) : {};

const SWEEP_CODE = `when world_start {
    all_mobs()
    @current entity.remove()
    reset()
}
`;

async function sweepMobs() {
  await toDev();
  await deploy(compile(k, { code: SWEEP_CODE }), {});
  await runScenario([], { settleMs: 500 });
}

function blocks(text) {
  return [...text.matchAll(/```kotlin\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
}

let broken = 0;
let total = 0;
let remarks = 0;
for (const file of readdirSync(GUIDE).filter((f) => f.endsWith(".md"))) {
  const parts = blocks(readFileSync(join(GUIDE, file), "utf8"));
  parts.forEach((code, i) => {
    total++;
    const { ok, diagnostics } = open(k, { code }).check();
    remarks += reviewFile(code).filter((remark) => remark.rule !== "формат").length;
    if (ok) return;
    broken++;
    const first = diagnostics.find((d) => d.severity === "error");
    console.log(`${file} блок ${i + 1}: ${first.line}: ${first.message}`);
  });
}
console.log(`Код в руководстве: блоков ${total}, не собирается ${broken}, замечаний к читаемости ${remarks}`);

const dir = join(GUIDE, "tests");
const suites = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && (!only || f.includes(only))) : [];
let passed = 0;
let failed = 0;
for (const file of suites) {
  const cases = JSON.parse(readFileSync(join(dir, file), "utf8"));
  for (const c of cases) {
    const key = `${file}:${c.name}`;
    validate(c.steps);
    const built = compile(k, { code: c.code });
    if (!built.ok) {
      failed++;
      results[key] = { ok: false, stage: "сборка", error: built.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.line}: ${d.message}`) };
      console.log(`✗ ${key}: не собирается: ${results[key].error[0]}`);
      continue;
    }
    if (!inGame) {
      passed++;
      continue;
    }
    if (results[key]?.ok) {
      passed++;
      continue;
    }
    try {
      await toDev();
      await deploy(built, {});
      const r = await runScenario(c.steps, { settleMs: c.settleMs ?? 1500, tolerate: c.tolerate });
      const { shots, ...rest } = r;
      results[key] = { ok: r.ok, seconds: r.seconds, failedStep: r.failedStep, steps: rest.steps.filter((s) => !s.ok), errors: r.errors, chat: r.chat.slice(-8) };
      r.ok ? passed++ : failed++;
      console.log(`${r.ok ? "✓" : "✗"} ${key} (${r.seconds} с)${r.ok ? "" : `: шаг ${r.failedStep}: ${rest.steps.find((s) => !s.ok)?.error ?? r.errors[0]}`}`);
      if (!r.ok && r.seen.spawned) await sweepMobs();
    } catch (e) {
      failed++;
      results[key] = { ok: false, stage: "игра", error: e.message };
      console.log(`✗ ${key}: ${e.message}`);
      if (/не отвечает|игрока нет|не на сервере/.test(e.message)) {
        writeFileSync(report, JSON.stringify(results, null, 1));
        console.log("Связь с игрой потеряна, останавливаюсь.");
        process.exit(2);
      }
    }
    writeFileSync(report, JSON.stringify(results, null, 1));
  }
}
console.log(`Проверки: прошло ${passed}, упало ${failed}`);
process.exit(broken || failed ? 1 : 0);
