import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDE } from "../src/paths.mjs";

const chat = (id, body) => `when player_chat {
    if not chat_message_equals("@${id}") {
        end_thread()
    }
    cancel_event()
${body.trim().split("\n").map((l) => `    ${l}`).join("\n")}
}
`;

const clean = (id) => `when player_chat {
    if not chat_message_equals("@${id}c") {
        end_thread()
    }
    cancel_event()
    entity_by_conditional(has_custom_tag("mod", "${id}"))
    n = value.selection_size
    @current entity.remove()
    reset()
    @default send_message("${id} убрано=\${n}")
}
`;

const at = "shift_all_coordinates(value.location, 0, 2, 3)";

const cases = [
  {
    name: "dp01 текст настраивается через @last, поля как в руководстве",
    id: "dp01",
    code: `spawn_text_display(${at}, "dp01", "&aПривет")
@last set_custom_tag("mod", "dp01")
@last set_display_billboard(billboard_type: vertical)
@last set_text_display_background("#000000", 0)
@last set_text_display_text_shadow()
@last set_display_scale(vec(2, 2, 2))
@default send_message("dp01 готово")`,
    steps: [{ expect: "dp01 готово" }, { display: { type: "text_display", name: "dp01", text: "Привет", billboard: "vertical", background: "#00000000", shadow: true, scale: [2, 2, 2], lineWidth: 200, count: 1 } }],
  },
  {
    name: "dp02 прозрачность: 98 это максимум, 100 переполняется и прячет текст",
    id: "dp02",
    code: `spawn_text_display(${at}, "dp02a", "a")
@last set_custom_tag("mod", "dp02")
@last set_text_display_opacity(98)
spawn_text_display(${at}, "dp02b", "b")
@last set_custom_tag("mod", "dp02")
@last set_text_display_opacity(100)
spawn_text_display(${at}, "dp02c", "c")
@last set_custom_tag("mod", "dp02")
@last set_text_display_opacity(50)
@default send_message("dp02 готово")`,
    steps: [{ expect: "dp02 готово" }, { display: { name: "dp02a", textOpacity: 253, count: 1 } }, { display: { name: "dp02b", textOpacity: 3, count: 1 } }, { display: { name: "dp02c", textOpacity: 131, count: 1 } }],
  },
  {
    name: "dp03 интерполяция: плавно только с вызовом перед изменением",
    id: "dp03",
    code: `spawn_block_display(${at}, "dp03", block(stone))
@last set_custom_tag("mod", "dp03")
last_entity()
wait(1)
@current set_display_interpolation(20, 0)
@current set_display_scale(vec(3, 3, 3))
wait(30)
@default send_message("dp03 готово")
reset()`,
    steps: [
      { wait: 400 },
      { java: 'Object e = null; Object it = mc.level.entitiesForRendering().iterator(); while (it.hasNext()) { Object x = it.next(); if (x.getName().getString().equals("dp03")) e = x; } float p = e.calculateInterpolationProgress(0f); return p > 0.05f && p < 0.95f;', equals: true },
      { expect: "dp03 готово", timeout: 4000 },
      { display: { name: "dp03", scale: [3, 3, 3], transformationInterpolationDuration: 20, count: 1 } },
    ],
  },
  {
    name: "dp04 плавный телепорт: один раз при создании, пауза 1 тик",
    id: "dp04",
    code: `start_at = ${at}
spawn_block_display(start_at, "dp04", block(stone))
@last set_custom_tag("mod", "dp04")
@last set_display_teleport_duration(20)
last_entity()
wait(1)
@current entity.teleport(shift_all_coordinates(start_at, 0, 5, 0))
wait(30)
@default send_message("dp04 готово")
reset()`,
    steps: [{ event: { type: "display_move" }, timeout: 3000 }, { expect: "dp04 готово", timeout: 4000 }, { display: { name: "dp04", posRotInterpolationDuration: 20, count: 1 } }],
  },
  {
    name: "dp05 порядок Эйлера Rz·Rx·Ry",
    id: "dp05",
    code: `spawn_block_display(${at}, "dp05", block(stone))
@last set_custom_tag("mod", "dp05")
@last set_display_rotation_from_euler_angles(30, 40, 50)
@default send_message("dp05 готово")`,
    steps: [{ expect: "dp05 готово" }, { display: { name: "dp05", leftRotation: [0.197, 0.36, 0.464, 0.785], count: 1 } }],
  },
  {
    name: "dp06 add снаружи, add_local внутри",
    id: "dp06",
    code: `spawn_block_display(${at}, "dp06a", block(stone))
@last set_custom_tag("mod", "dp06")
@last set_display_rotation_from_axis_angle(vec(1, 1, 1), 120)
@last set_display_rotation_from_euler_angles(0, 0, 30, mode: add)
spawn_block_display(${at}, "dp06b", block(stone))
@last set_custom_tag("mod", "dp06")
@last set_display_rotation_from_axis_angle(vec(1, 1, 1), 120)
@last set_display_rotation_from_euler_angles(0, 0, 30, mode: add_local)
@default send_message("dp06 готово")`,
    steps: [{ expect: "dp06 готово" }, { display: { name: "dp06a", leftRotation: [0.354, 0.612, 0.612, 0.354], count: 1 } }, { display: { name: "dp06b", leftRotation: [0.612, 0.354, 0.612, 0.354], count: 1 } }],
  },
  {
    name: "dp07 матрица рядами, поворот по вектору кладёт +z на направление",
    id: "dp07",
    code: `spawn_block_display(${at}, "dp07a", block(stone))
@last set_custom_tag("mod", "dp07")
@last set_display_correct_transformation_matrix([1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
spawn_block_display(${at}, "dp07b", block(stone))
@last set_custom_tag("mod", "dp07")
@last set_display_rotation_from_vector(vec(1, 0, 0), vec(0, 1, 0))
@default send_message("dp07 готово")`,
    steps: [{ expect: "dp07 готово" }, { display: { name: "dp07a", translation: [2, 0, 0], count: 1 } }, { display: { name: "dp07b", leftRotation: [0, 0.707, 0, 0.707], count: 1 } }],
  },
  {
    name: "dp08 визуализатор переживает перезапуск мира",
    id: "dp08",
    code: `spawn_text_display(${at}, "dp08", "x")
@last set_custom_tag("mod", "dp08")
@default send_message("dp08 готово")`,
    steps: [{ expect: "dp08 готово" }, { say: "/build" }, { wait: 3000 }, { say: "/play" }, { wait: 3000 }, { display: { name: "dp08", count: 1 } }],
  },
  {
    name: "dp09 всадник стоит над игроком, телепорт его ссаживает",
    id: "dp09",
    code: `spawn_text_display(value.eye_location, "dp09", "x")
@last set_custom_tag("mod", "dp09")
@last entity.ride_entity(value.uuid)
last_entity()
wait(5)
@default send_message("dp09 сел")
wait(40)
@current entity.teleport(shift_all_coordinates(value.location, 3, 2, 3))
wait(5)
@default send_message("dp09 слез")
reset()`,
    steps: [{ expect: "dp09 сел", timeout: 3000 }, { display: { name: "dp09", riding: "player", count: 1 } }, { expect: "dp09 слез", timeout: 5000 }, { java: 'Object e = null; Object it = mc.level.entitiesForRendering().iterator(); while (it.hasNext()) { Object x = it.next(); if (x.getName().getString().equals("dp09")) e = x; } return e.isPassenger();', equals: false }],
  },
  {
    name: "dp10 голограмма: стойка на строку, та же точка заменяет, пустой текст убирает",
    id: "dp10",
    code: `spot = ${at}
display_hologram(spot, "dp10 один\\ndp10 два")
wait(30)
display_hologram(spot, "dp10 новая")
wait(30)
display_hologram(spot, "")
wait(10)
@default send_message("dp10 готово")`,
    steps: [{ entity: { type: "armor_stand", name: "dp10 два", count: 1 }, timeout: 1200 }, { entity: { type: "armor_stand", name: "dp10 новая", count: 1 }, timeout: 3000 }, { expect: "dp10 готово", timeout: 5000 }, { no_entity: { name: "dp10" } }],
  },
  {
    name: "dp11 поиск: имя с цветом, mob_by_name находит, is_mob ложь",
    id: "dp11",
    code: `spawn_text_display(${at}, "&cdp11", "x")
@last set_custom_tag("mod", "dp11")
wait(2)
mob_by_name("&cdp11")
a = value.selection_size
reset()
entity_by_name("dp11")
b = value.selection_size
reset()
all_mobs()
c = value.selection_size
reset()
@default send_message("dp11 a=\${a} b=\${b} c=\${c}")`,
    steps: [{ expect: "dp11 a=1(\\.0)? b=0(\\.0)? c=0(\\.0)?" }],
  },
  {
    name: "dp12 подпись на игроке снимается смертью",
    id: "dp12",
    code: `spawn_text_display(value.eye_location, "dp12", "x")
@last set_custom_tag("mod", "dp12")
@last entity.ride_entity(value.uuid)
wait(5)
player.damage(9999)`,
    steps: [{ state: { screen: "DeathScreen" }, timeout: 3000 }, { respawn: true }, { wait: 1500 }, { java: 'Object e = null; Object it = mc.level.entitiesForRendering().iterator(); while (it.hasNext()) { Object x = it.next(); if (x.getName().getString().equals("dp12")) e = x; } return e.isPassenger();', equals: false }],
  },
];

const out = cases.map(({ name, id, code, steps }) => ({
  name,
  code: `${chat(id, code)}\n${clean(id)}`,
  steps: [{ say: `@${id}` }, ...steps, ...(id === "dp10" || id === "dp11x" ? [] : [{ say: `@${id}c` }, { expect: `${id} убрано=` }])],
}));

writeFileSync(join(GUIDE, "tests", "displays.json"), JSON.stringify(out, null, 1));
console.log(`рецептов ${out.length}`);
