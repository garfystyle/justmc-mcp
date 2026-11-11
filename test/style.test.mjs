import assert from "node:assert/strict";
import { test } from "node:test";
import { blankStringsAndComments, isCrypticName, isGeneratedData, reviewFile, reviewProject } from "../src/xero/style.mjs";

const rules = (code) => reviewFile(code).map((remark) => remark.rule);

const READABLE = `const MODE_IDLE = 0
const MODE_FIGHT = 1
const BOSS_TAG = "boss"

game boss_mode
game \`frame_delays %var_line(clip_name)\`: list

func play_clip(clip_name: text) {
    line delays = \`frame_delays %var_line(clip_name)\`
    for frame in 0..len(delays) - 1 {
        if boss_mode != MODE_FIGHT {
            return
        }
        wait(delays[frame])
    }
}

when player_join {
    boss_mode = MODE_FIGHT
    play_clip("walk")
    boss_mode = MODE_IDLE
}
`;

test("читаемый код замечаний не получает", () => {
  assert.deepEqual(reviewFile(READABLE), []);
});

test("короткие и бессловесные имена считаются непонятными", () => {
  for (const name of ["b_gd", "cn", "fi", "pf", "PB", "MARK_K", "cnt", "dmg", "s0"]) assert.equal(isCrypticName(name), true, name);
});

test("обычные имена не считаются непонятными", () => {
  for (const name of ["i", "x", "boss_health", "frame_delay", "id", "hp", "player_id", "здоровье_босса", "монеты %player%", "npc_name", "point2"]) {
    assert.equal(isCrypticName(name), false, name);
  }
});

test("имена из кода босса попадают в замечание со строкой", () => {
  const [remark] = reviewFile("game b_gd\n\nwhen player_join {\n    b_gd = 1\n}\n");
  assert.equal(remark.rule, "имена");
  assert.match(remark.text, /`b_gd` \(1\)/);
});

test("состояние числами просит имена, ноль сам по себе нет", () => {
  const numbered = `game state_of_fight
when player_join {
    if state_of_fight == 1 { wait(1) }
    if state_of_fight != 1 { wait(1) }
    if state_of_fight == 2 { wait(1) }
}
`;
  assert.ok(rules(numbered).includes("состояния"));
  const zero = numbered.replaceAll(/== 1|!= 1|== 2/g, "== 0");
  assert.ok(!rules(zero).includes("состояния"));
});

test("повтор значения считается вне const и вне строк с комментариями", () => {
  const lines = Array.from({ length: 5 }, (_, i) => `    set_health(0.37 + ${i})`).join("\n");
  assert.ok(rules(`when player_join {\n${lines}\n}\n`).includes("литералы"));
  assert.ok(!rules(`const PART = 0.37\n// 0.37 0.37 0.37 0.37 0.37\nwhen player_join {\n    send_message("0.37 0.37 0.37 0.37 0.37")\n}\n`).includes("литералы"));
});

test("значения в многострочном const считаются объявленными", () => {
  const body = Array.from({ length: 6 }, (_, i) => `    part_${i}: 0.37,`).join("\n");
  assert.ok(!rules(`const PART_SIZES = {\n${body}\n}\n\nwhen player_join {\n    wait(1)\n}\n`).includes("литералы"));
});

test("короткая строка, повторённая четыре раза, просит const", () => {
  const lines = Array.from({ length: 4 }, () => `    set_custom_tag("role", "f")`).join("\n");
  assert.match(reviewFile(`when player_join {\n${lines}\n}\n`).find((r) => r.rule === "литералы").text, /"f" ×4/);
});

test("длинный обработчик и глубокая вложенность замечаются", () => {
  const body = Array.from({ length: 45 }, (_, i) => `    wait(${i + 1})`).join("\n");
  assert.ok(rules(`func long_function() {\n${body}\n}\n`).includes("размер"));
  assert.ok(rules(`func nested() {
    if a > 0 {
        if a > 1 {
            if a > 2 {
                if a > 3 {
                    wait(1)
                }
            }
        }
    }
}
`).includes("вложенность"));
});

test("счётчик руками заменяется на for, если растёт в конце тела", () => {
  assert.ok(rules(`func count_up() {
    line step = 0
    while step < 5 {
        wait(1)
        step += 1
    }
}
`).includes("циклы"));
  assert.ok(!rules(`func count_up() {
    line step = 0
    while step < 5 {
        step += 1
        wait(step)
    }
}
`).includes("циклы"));
});

test("get_list_value заменяется индексом", () => {
  assert.ok(rules(`func first(items: list) {\n    return get_list_value(items, 0)\n}\n`).includes("индекс"));
});

test("повторённые куски находятся и с другими числами", () => {
  const block = (n) => `    @last set_custom_tag("role", "part")
    @last set_display_scale(vec(${n}, ${n}, ${n}))
    @last set_display_brightness(15, 15)
    @last set_display_view_range(${n})
`;
  assert.ok(rules(`func spawn_parts() {\n${block(1)}    wait(1)\n${block(2)}}\n`).includes("повтор"));
});

test("строки и комментарии не считаются кодом", () => {
  const { code, strings } = blankStringsAndComments(`x = "a // b" // c\n/* d\n e */ y = \`имя %player%\`\n`);
  assert.equal(strings[0].value, "a // b");
  assert.doesNotMatch(code, /a|b|c|d|e|имя/);
  assert.match(code, /x =/);
  assert.match(code, /y =/);
  assert.equal(code.length, `x = "a // b" // c\n/* d\n e */ y = \`имя %player%\`\n`.length);
});

test("сгенерированные данные не проверяются", () => {
  const data = `const FRAMES = [${"1, ".repeat(1200)}1]\n`;
  assert.equal(isGeneratedData(data), true);
  assert.deepEqual(reviewFile(data), []);
});

test("перевод строки Windows не считается нарушением формата", () => {
  assert.deepEqual(reviewFile(READABLE.replaceAll("\n", "\r\n")), []);
});

test("замечания проекта подписаны файлом, заглушка папки пропускается", () => {
  const texts = new Map([["C:/game/", 'import "a.xero"\n'], ["a.xero", "game b_gd\n"], ["b.xero", "game boss_health\n"]]);
  const remarks = reviewProject(texts);
  assert.equal(remarks.length, 1);
  assert.equal(remarks[0].file, "a.xero");
});
