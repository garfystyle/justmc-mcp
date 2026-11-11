import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { applyFixes, format } from "../xero/core.mjs";
import { lint } from "../xero/lint.mjs";
import { FORMAT_RULE, isGeneratedData, reviewProject } from "../xero/style.mjs";
import { compile, deploy, open, removeProject } from "../game/deploy.mjs";
import { staleParts } from "../game/freshness.mjs";
import { toDev } from "../game/modes.mjs";
import { isServiceReport } from "../game/replies.mjs";
import { runScenario, validate } from "../game/scenario.mjs";
import { runningScripts } from "../game/scripts.mjs";
import { failure, images, register } from "./common.mjs";

const SOURCE = {
  code: z.string().optional().describe("Текст .xero"),
  path: z.string().optional().describe("Файл .xero, папка проекта или .json модуля"),
};

const shortFile = (file) => String(file).split("/").filter(Boolean).pop();

function explain(k, diagnostics) {
  return diagnostics
    .map((d) => {
      const lines = [`${d.severity === "error" ? "ошибка" : "предупреждение"} ${d.file === "main.xero" ? "" : `${shortFile(d.file)}:`}${d.line}:${d.column} ${d.message}`];
      if (d.code) lines.push(`  ${d.code}`);
      if (d.hint) lines.push(`  → ${d.hint}`);
      for (const f of d.fixes ?? []) lines.push(`  ✎ ${f.title}`);
      const unknown = d.message.match(/^нет (?:действия|события|условия|значения|игрового значения) «(.+?)»/);
      if (unknown && !d.hint && k.ready) {
        const near = k.lookup(unknown[1].replaceAll("_", " "), { limit: 5 }).map((r) => r.name);
        if (near.length) lines.push(`  → может быть: ${near.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

const STEP_NOTE_LIMIT = 400;
const STEP_TEXT_LIMIT = 90;
const CHAT_LINES = 20;
const DEBUG_FILE = /\.debug\.xero$/;

const stepLine = (s) => {
  const seconds = ((s.at ?? 0) / 1000).toFixed(1);
  const did = s.did.replace(/[{}"]/g, "").slice(0, STEP_TEXT_LIMIT);
  const note = s.note ? ` → ${String(s.note).slice(0, STEP_NOTE_LIMIT)}` : "";
  return `${s.step ?? "·"} ${s.ok ? "✓" : "✗"} ${seconds}с ${did}${note}${s.error ? `: ${s.error}` : ""}`;
};

const withoutRepeats = (lines) => lines.filter((line, i) => line !== lines[i - 1]);

export const scenarioReport = ({ shots, steps, chat, errors, ...rest }) => ({
  ...rest,
  steps: steps.map(stepLine),
  ...(errors.length ? { errors: [...new Set(errors)] } : {}),
  chat: withoutRepeats(chat).filter((line) => !errors.includes(line) && !isServiceReport(line)).slice(-CHAT_LINES),
});

function styleSection(built) {
  const remarks = reviewProject(built.texts ?? new Map());
  if (!remarks.length) return [];
  const many = new Set(remarks.map((r) => r.file)).size > 1;
  const unformatted = remarks.filter((r) => r.rule === FORMAT_RULE);
  const rest = remarks.filter((r) => r.rule !== FORMAT_RULE).map((r) => `- ${many ? `${r.file}: ` : ""}${r.text}`);
  const formatLine = unformatted.length ? [`- не в стиле Xero: ${unformatted.map((r) => r.file).join(", ")}. Один вызов check с format=true приведёт всё`] : [];
  return [`Читаемость: замечаний ${rest.length + formatLine.length}, поправь до сдачи (guide style):`, ...formatLine, ...rest];
}

function report(k, built) {
  const errors = built.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = built.diagnostics.length - errors;
  const head = errors
    ? `Не собирается: ошибок ${errors}, предупреждений ${warnings}.`
    : `Собирается: строк ${built.lines ?? "?"}, блоков ${built.blocks ?? "?"}${warnings ? `, предупреждений ${warnings}` : ""}.`;
  const advice = errors || !built.module ? [] : lint(built.module).map((a) => `совет ${a.where}: ${a.text}`);
  const style = errors ? [] : styleSection(built);
  return [head, ...(built.diagnostics.length ? [explain(k, built.diagnostics)] : []), ...advice, ...style].join("\n");
}

function rewritten(body, diagnostics, { pretty, fix }) {
  const fixed = fix ? applyFixes(body, diagnostics) : { text: body, applied: 0 };
  const styled = pretty ? format(fixed.text) : null;
  return { text: styled?.ok ? styled.text : fixed.text, applied: fixed.applied };
}

function rewriteFiles(project, built, options) {
  let applied = 0;
  let changed = 0;
  for (const [name, original] of project.texts) {
    if (name.endsWith("/") || isGeneratedData(original)) continue;
    const next = rewritten(original, built.diagnostics.filter((d) => d.file === name), options);
    applied += next.applied;
    if (next.text === original) continue;
    writeFileSync(resolve(project.home, name), next.text);
    changed++;
  }
  return { applied, changed };
}

export function registerCode(server, k) {
  register(server, "check", {
    title: "Проверить код Xero",
    description: "Собирает .xero: ошибки и предупреждения со строкой, подсказкой и правкой, советы и раздел «Читаемость»: имена, числа вместо состояний, повторы, размер функций. Код сдаётся только без замечаний. fix=true применяет правки компилятора, format=true приводит к стилю; с path пишет в файл, с code возвращает текст. Мир не трогает.",
    schema: { ...SOURCE, format: z.boolean().optional(), fix: z.boolean().optional() },
    readOnly: true,
  }, ({ format: pretty, fix, ...source }) => {
    const built = (input) => {
      const project = open(k, { ...input, debug: true });
      return { project, result: { ...project.build(), texts: project.texts } };
    };
    const { project, result } = built(source);
    if (!pretty && !fix) return report(k, result);
    const options = { pretty: pretty && result.ok, fix };
    if (source.path) {
      const { applied, changed } = rewriteFiles(project, result, options);
      return `${report(k, built(source).result)}\n${fix ? `Правок применено: ${applied}. ` : ""}Файлов обновлено: ${changed}.`;
    }
    const next = rewritten(source.code, result.diagnostics, options);
    return `${report(k, built({ code: next.text }).result)}${fix ? `\nПравок применено: ${next.applied}.` : ""}\n\n${next.text}`;
  });

  register(server, "test", {
    title: "Проверить код в игре",
    description: `Главный инструмент. Заливает код, заходит игроком в /play, выполняет шаги и возвращает отчёт: шаги, ошибки сервера, чат и всё, что клиент увидел (seen: звуки, частицы, тайтлы, экшенбар, боссбар, заспавненные сущности, изменённые блоки). При провале прикладывает снимок. Потом возвращает в /dev. Без code/path проверяет то, что уже в мире.
Шаг — объект с одним глаголом, timeout в мс где есть ожидание:
Действия: say:"/cmd" (пауза 1.6 с сама) · wait:мс · goto:{x,y,z}|{dx,dz}|{entity} · look:{x,y,z}|{yaw,pitch}|{entity} · move:{keys,ms} · jump:true · sneak:мс · use:true|мс · attack:n · drop:true · hotbar:0-8 · click:слот|"имя"|{slot,item,button,input} · close:true · respawn:true (выйти с экрана смерти, в конце сценария делается само) · java:"код"+equals · shot:true|{orbit:{x,y,z,radius,height,views}}|{camera:{x,y,z,lookAt:{x,y,z}}} снимок.
Проверки: expect:"regex" (новая строка чата) · absent:"regex" · actionbar, title, subtitle, bossbar, sound (entity.player.levelup), particle (flame), effect: "regex" · sidebar:"regex" · tab:"regex" · gui:"regex" · item:"regex"+count|exactly · no_item:"regex" · block:{x,y,z,is} · entity:{type,name,count,atLeast,radius} · no_entity:{…} · display:{type:"text_display",text,name,count,scale:[1,1,1],translation,billboard,background,…} поля как в see displays · state:{health,mode,effect,near:{x,y,z,radius}} · event:{type,match} · var:"имя"|{name,scope:game|save,equals,match} настоящее значение переменной из мира · no_var:"имя" · track:{name,type,ms,jumps,radius} нет ли рывков у частей модели и у сущности целиком, jumps: сколько рывков можно, по умолчанию 0 · limits:true нагрузка мира в этот момент.
У entity, display и no_entity радиус по умолчанию 32, у track 64. attack не падает при промахе: смотри заметку шага. В seen есть health и deaths.
Файлы *.debug.xero из папки проекта заливаются только здесь: держи в них тестовые команды, в deploy они не попадут.
Сценарий ограничен budget секунд, для боя и прочего долгого есть script run с background.`,
    schema: {
      ...SOURCE,
      steps: z.array(z.record(z.string(), z.any())).optional().describe("Сценарий; без него просто зайдёт и посмотрит на ошибки"),
      settleMs: z.number().int().optional().describe("Пауза после входа в мир, по умолчанию 1500"),
      stay: z.boolean().optional().describe("Остаться в /play"),
      restart: z.boolean().optional().describe("Перезапустить мир через /build и /play: только так срабатывает world_start и гибнут старые процессы. По умолчанию да, если залит код"),
      tolerate: z.string().optional().describe("Regex ошибок сервера, которые ожидаемы"),
      project: z.string().optional().describe("Имя проекта: своя заливка не трогает строки других проектов"),
      drop: z.boolean().optional().describe("Разрешить замену одноимённых func и process, залитых не этим проектом"),
      budget: z.number().int().min(5).max(600).optional().describe("Предел сценария в секундах, по умолчанию 100"),
    },
    destructive: true,
    openWorld: true,
  }, async ({ code, path, steps = [], settleMs, stay, tolerate, restart, project, drop, budget }) => {
    validate(steps);
    if (runningScripts().length) throw new Error(`идёт скрипт ${runningScripts().join(", ")}: test перезапустит мир и собьёт его. Дождись его (script wait) или останови (script stop)`);
    const out = {};
    const stale = staleParts();
    if (code != null || path != null) {
      const built = compile(k, { code, path, debug: true });
      if (!built.ok) return failure(report(k, built));
      if (built.diagnostics.length) out.warnings = explain(k, built.diagnostics);
      const advice = lint(built.module);
      if (advice.length) out.advice = advice.map((a) => `${a.where}: ${a.text}`);
      const style = reviewProject(built.texts ?? new Map());
      if (style.length) out.style = `замечаний к читаемости ${style.length}, смотри check`;
      await toDev();
      const done = await deploy(built, { name: project, drop });
      out.deploy = done.notes.join("\n");
      const debug = [...(built.texts?.keys() ?? [])].filter((file) => DEBUG_FILE.test(file));
      if (debug.length) done.warnings.push(`В мире теперь отладочный код (${debug.map(shortFile).join(", ")}): перед сдачей залей deploy без него, в открытом мире его команды доступны всем.`);
      if (done.warnings.length) out.attention = done.warnings;
    }
    if (stale.length) out.attention = [...stale, ...(out.attention ?? [])];
    const r = await runScenario(steps, { settleMs, stay, tolerate, restart: restart ?? (code != null || path != null), budgetSeconds: budget });
    const { attention, ...tail } = out;
    const { inline, saved } = images(r.shots.map((shot) => shot.data));
    const report = { ...(attention ? { attention } : {}), ...scenarioReport(r), ...tail, ...(saved.length ? { shotsOnDisk: saved } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(report, null, 1) }, ...inline], ...(r.ok ? {} : { isError: true }) };
  });

  register(server, "deploy", {
    title: "Залить код в мир",
    description: "Заливает код без проверки в игре, сам переходит в /dev. По умолчанию заменяет только то, что залито отсюда раньше, чужие строки мира не трогает. Одноимённые чужие func и process не заменяет: откажет без drop. mode=world заменяет весь код мира (откажет без drop, если что-то сотрётся). dry показывает, что изменится, и работает из любого режима. resend заливает, даже если по файлу мира код уже там: после отката мира или правки руками. remove=true без кода убирает из мира строки проекта project, остальное не трогает: так убираются пробы.",
    schema: {
      ...SOURCE,
      mode: z.enum(["project", "world"]).optional(),
      drop: z.boolean().optional(),
      dry: z.boolean().optional(),
      project: z.string().optional().describe("Имя проекта: своя заливка не трогает строки других проектов"),
      resend: z.boolean().optional(),
      remove: z.boolean().optional(),
    },
    destructive: true,
    openWorld: true,
  }, async ({ mode, drop, dry, resend, project, remove, ...source }) => {
    if (remove) {
      if (!dry) await toDev();
      return (await removeProject({ name: project, dry })).notes.join("\n");
    }
    const built = compile(k, source);
    if (!built.ok) return failure(report(k, built));
    if (!dry) await toDev();
    const done = await deploy(built, { mode, drop, dry, resend, name: project });
    return [...staleParts(), ...done.warnings.map((w) => `Внимание: ${w}`), ...done.notes].join("\n");
  });
}
