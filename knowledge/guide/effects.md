# Эффекты: частицы, звук, экран

Основы титула и босс-бара — в `loops-ui`, луч оружия — в `combat-entities`. «Код клиента» значит прочитано в клиенте 26.2, а не запущено на сервере. Рецепты прогнаны на сервере 04.11.2026: 10 из 15. Босс-бар из `entity_take_damage` (fx12) и облако (fx15) не подтвердились, бери их с проверкой.

## Кому показать
Частицы, звук, титул, бары, `display_lightning` — действия над игроком: цель решает, кто увидит, а не где.

| Кто видит | Запись | Для чего |
|:--|:--|:--|
| игрок события | без цели | меню, ответ на команду |
| весь мир | `@all` | то, что есть в мире: взрыв, аура |
| вторая сторона | `@victim`, `@killer` | экран жертвы, щелчок попадания |
| рядом, команда | выборка, без цели, `reset()` | большой мир |

```kotlin
func near_boom(at: location) {
    player_by_conditional(is_near(24, at, ignore_y_axis: false))
    display_particle(particle(explosion_emitter), at)
    play_sound(sound(entity.generic.explode), at)
    reset()
}
when player_damage_player {
    @all display_particle(particle(damage_indicator, count: 2), @victim value.eye_location)
    play_sound(sound(entity.arrow.hit_player, pitch: 1.5))
}
```
- Частицы мировые: `@all` у 237 из 314 `display_particle`. Текст личный: 51 из 279 `send_title`, 62 из 572 `send_action_bar`.
- Цель и место независимы: `@victim display_particle(p, value.location)` покажет жертве частицу у ног бьющего.
- `display_lightning` без цели (52 из 55) видит один игрок. В `world_start` и `no_target` без `@all` не увидит никто, место там — `@current value.location` или параметр.

## Частица как значение
```kotlin
const PUFF = particle(cloud, count: 25, first_spread: 1, second_spread: 0.3, y_motion: 0.2)
const FADE = particle(dust_color_transition, color: "#ffbf00", to_color: "#ff0040", size: 2)
when player_sneak {
    under = shift_coordinate(value.location, -0.25, type: y)
    ground = get_block_material(under, value_type: item)
    chips = set_particle_material(particle(block, count: 10, first_spread: 1, second_spread: 1), ground)
    @all display_particle([PUFF, FADE, chips], [value.location, value.eye_location])
}
```
| Поле | Смысл | У кого |
|:--|:--|:--|
| `count` | сколько разом, целое | у всех |
| `first_spread`, `second_spread` | разброс: горизонталь, вертикаль | у всех |
| `x_motion` `y_motion` `z_motion` | скорость | 39 частиц: `flame` `smoke` `cloud` `end_rod` `crit` `block`… |
| `color` | `"#rrggbb"` | `dust` `dust_color_transition` `flash` `entity_effect` `note` `trail`… |
| `to_color` | цвет в конце жизни | `dust_color_transition` |
| `size` | размер | `dust` `dust_color_transition` `sweep_attack` `shriek`… |
| `material` | id блока, предмета | `block` `item` `falling_dust` `block_marker` `dust_pillar` |

- Частые: `dust` (88 раз, 41 модуль), `end_rod`, `explosion_emitter`, `smoke`, `small_flame`, `crit`, `flash`.
- Компилятор поля не сверяет: `particle(flame, color: "#ff0000")` соберётся, а красным не станет.
- Только `first_spread` (87 раз, 28 модулей) даёт плоский блин: вертикальный разброс остаётся нулём.
- До 20 частиц и 20 мест в блоке, списком (31 модуль). Пропуски `[_, _, x]` в чужом коде — раскладка сундука, не пиши их.
- `particle(...)` и `sound(...)` постоянные: `count: n` и `color: hue` с переменной не собираются. Переменное — действием с присвоением: `set_particle_amount(p, n)`, `set_particle_color(p, hex)`, `set_particle_size`, `set_particle_spread(p, h, v)`, `set_particle_offset(p, vec)`, `set_particle_material(p, предмет)`.

## Фигуры одним блоком
| Фигура | Запись | Вызовов, модулей |
|:--|:--|:--|
| линия | `display_particle_line(p, a, b, 0.5, unit_of_measurement: distance)` | 154, 44 |
| луч | `display_particle_ray(p, start, вектор, 0.5, unit_of_measurement: distance)` | 3, 2 |
| окружность | `display_particle_circle(p, центр, радиус, точек, угол, vec(0, 1, 0))` | 34, 9 |
| сфера | `display_particle_sphere(p, центр, радиус, точек)` | 77, 18 |
| куб | `display_particle_cube(p, угол1, угол2, шаг, type: wireframe)` | 50, 4 |
| спираль | `display_particle_spiral(p, центр, дистанция, радиус, точек, оборотов, угол)` | в модулях нет |

- У линии и луча без маркера четвёртое число — количество точек, с `distance` — шаг в блоках. Шаг берут 31 модуль из 44: длина меняется, плотность нет.
- `vec(0, 1, 0)` — нормаль: кольцо лежит.
- Длина луча — длина вектора (вывод из кода `ЛАЗЕРЫ ИЗ ГЛАЗ`, `Katana`): на 10 блоков нужен `multiply_vector(value.direction_of_view, 10)`.
- Рамка региона: `type: wireframe`, ещё `solid`, `hollow`. `WorldEdit` тратит на неё двенадцать линий.
- Ось спирали и смысл `distance` не проверены.

## Фигура по точкам
Цикл нужен, только если на точке что-то происходит: пауза, урон, блок.
```kotlin
process draw_ring(at: location) {
    on_circle(pos, at, 3, 24, vec(0, 1, 0), 0) {
        @all display_particle(particle(end_rod), pos)
        wait(1)
    }
}
```
- Порядок другой: `on_circle(x, центр, радиус, точек, нормаль, угол)` и `display_particle_circle(p, центр, радиус, точек, угол, нормаль)`. Надёжнее именем: `start_angle: 0`.
- Ещё `on_sphere(x, центр, радиус, точек)` и `on_path(x, шаг, [a, b, c])`, цепочка до 21 точки.
- Точек выходит на одну больше заказанных: `on_circle` на 12 даёт 13 шагов (круг замыкается), `on_sphere` на 30 даёт 31 (проверено, fx03).
- Формулы: `sin`, `cos` в градусах, `sinr`, `cosr` в радианах. Точка на кольце: `shift_all_coordinates(at, radius * cos(angle), height, radius * sin(angle))`.
- От взгляда: `shift_location_in_direction(value.eye_location, 2)`, ещё `direction: sideways`, `upward`. Поворот: `rotate_vector_around_axis(v, 20, axis: y)`.

## Анимация во времени
Эффект с паузами живёт в процессе, место приходит параметром: эффект стоит там, где начался. Без `target_mode` в процессе `value.location` читается заново и едет за игроком.
```kotlin
process shockwave(at: location) {
    for radius in 1..8 {
        @all display_particle_circle(particle(cloud), at, radius, radius * 8, 0, vec(0, 1, 0))
        wait(1)
    }
}
process spinner(at: location, ticks: number) {
    angle = 0
    repeat ticks / 2 {
        angle = wrap(angle + 12, 0, 360)
        @all display_particle_circle(particle(end_rod), at, 1.5, 3, angle, vec(0, 1, 0))
        wait(2)
    }
}
process rainbow(at: location) {
    hue = 0
    repeat 40 {
        hue = wrap(hue + 15, 0, 360)
        hex = to_hsb(hue, 100, 100)
        ring_particle = set_particle_color(particle(dust, size: 1.5), hex)
        @all display_particle_circle(ring_particle, at, 2, 20, 0, vec(0, 1, 0))
        wait(2)
    }
}
when player_swap_hands {
    cancel_event()
    start shockwave(value.location, target_mode: no_target)
    start spinner(value.location, 60, target_mode: no_target)
    start rainbow(value.location, target_mode: no_target)
}
```
- Волна: точек — радиус × 8, плотность постоянна. `FunTime Items` и `Ядерка` растят радиус при постоянных 100–150 точках.
- Вращение: 3 точки и растущий `start_angle`, один блок. В модулях этого нет: угол там постоянный, точек 100–200, кольцо стоит.
- Радуга: `to_hsb` и `set_particle_color` в модулях нет, цвет там берут `random([...])` из готовых (`Меч мироходца`).
- Спираль, растущая по времени: `shift_all_coordinates(at, cos(i * 18), i * 0.05, sin(i * 18))` в `for i in 0..60`.
- Нарастание (`КАСТОМ КЕЙСЫ`, 504 установки): четыре шага с `wait(6)`, точка поднимается, высота `set_sound_pitch(s, 0.5 + i / 3)`, в конце `entity.player.levelup`.

## Аура и шлейф
Один цикл на мир и список включивших.
```kotlin
game aura: list
process auras() {
    angle = 0
    forever {
        wait(4)
        angle = wrap(angle + 30, 0, 360)
        for name in aura {
            player_by_name(name)
            at = @current value.location
            @all display_particle_circle(particle(end_rod), at, 0.8, 4, angle, vec(0, 1, 0))
        }
        reset()
    }
}
when world_start {
    aura = []
    start auras(target_mode: no_target)
}
when player_quit {
    aura = remove_list_value(aura, value.name, remove_mode: all)
}
```
- `forever` в `player_join` (`ЛАЗЕРЫ ИЗ ГЛАЗ`) — цикл на игрока, выключить его нечем.
- Сначала ищи событие: `player_jump` (`Круг при прыжке`), `player_sneak`, `player_start_flight` (`Облако в бутылке`), `player_teleport`, `player_take_damage` с `damage_cause_equals` (`Модуль Частиц`).
- Шлейф: `when player_move { if is_sprinting() { @all display_particle(particle(cloud), value.location) } }`. Событие частое: одна частица, не фигура. `Модуль на ⛏ Ломай блок!` рисует в нём четыре линии неподвижной рамки, им хватило бы цикла раз в 10 тиков.
- Зона без цикла: `spawn_effect_cloud(место, частица, длительность, "имя", радиус, зелье)` дымит и действует сама (`War mehanics`, `светошумная граната`, 7 модулей).

## След снаряда
След встроен в запуск, цикл не нужен: 65 вызовов в 25 модулях.
```kotlin
const SHOT = "fx_bolt"
when player_right_click {
    if is_holding(item(blaze_rod)) {
        cancel_event()
        player.launch_projectile(item(snowball), value.eye_location, SHOT, 1.5, 0, particle(flame))
    }
}
when player_projectile_hit {
    if @projectile entity.name_equals(SHOT) {
        @all display_particle(particle(explosion), @projectile value.location)
    }
}
```
- Порядок разный: `player.launch_projectile(предмет, место, имя, скорость, разброс, след)`, `game.launch_projectile(предмет, место, скорость, разброс, имя, след)`. Надёжнее `trail: particle(flame)`.
- У стрелы из лука этого параметра нет: `player_shot_bow`, `cancel_event()` и запуск своей (`Классические оружия`).

## Цена для сервера
Цена фигуры: точки × зрители × частота. `count` — другое дело: в Minecraft это поле одного пакета, размножает клиент; на JustMC не замерено.

| Рычаг | Лучше | Худшее в модулях |
|:--|:--|:--|
| блоков на фигуру | один `display_particle_circle` | `on_circle` с действием внутри: блок на точку |
| точек окружности | 16–40 | `Круг при прыжке`: 500 000 на прыжок |
| точек сферы | 60–200 | `Майлз Моралес`: 10 000 при `count: 10` каждый тик |
| шаг линии | 0.25–0.5 | 0.1 у 16 модулей: 500 частиц на 50 блоков |
| куб | `wireframe`, шаг от 0.5 | `bumbum`: сплошной с шагом 0.1, `count: 100`, каждый тик |
| период | 2–5 тиков, неподвижное 10 | `wait(1)` у 28 модулей |
| зрители | рядом, если мир большой | `@all`, хотя дальше 32 блоков обычную частицу клиент не рисует (код клиента) |

Украшение при нагрузке пропускают, а не ждут.
```kotlin
process field(at: location) {
    forever {
        wait(5)
        if value.particle_cpu_usage < 65 {
            @all display_particle_sphere(particle(end_rod), at, 3, 80)
        }
    }
}
```
- `value.particle_cpu_usage` — доля частиц в нагрузке (`Datchik`), `value.cpu_usage` — вся (`Перекати-поле`, порог 65). Обязательную работу ждут: `while value.cpu_usage >= 70 { wait(1) }`, ошибки — таблица в `loops-ui`.
- `value.particle_visibility` — настройка игрока `all`, `decreased`, `minimal`: важную подсказку одними частицами не давай.

## Звук
```kotlin
const CLICK = sound(ui.button.click, pitch: 1.5, volume: 0.5)
func jitter(base: sound) {
    return set_sound_pitch(base, random_number(0.85, 1.15, integer: false))
}
when player_right_click {
    play_sound(CLICK)
    boom = jitter(sound(entity.generic.explode, volume: 3))
    @all play_sound(boom, value.location)
}
```
| Поле | Смысл |
|:--|:--|
| `pitch` | клиент обрезает до 0.5–2 (код клиента). Чаще всего 2 и 0.5 |
| `volume` | 0–1 громкость. Выше громче не станет, растёт дальность: 16 блоков × `volume` |
| `source` | ползунок игрока: `master` `music` `record` `weather` `block` `hostile` `neutral` `player` `ambient` `voice` `ui` |
| `variation` | конкретный файл: `"cave4"`, список — `get_sound_variations(s)` |

- `volume: 100` (61 раз, 24 модуля) значит «слышно за 1600 блоков», `100000000000000000` к этому ничего не добавляет. Всем на карте проще без места, `@all play_sound(s)`: без места звук рядом с игроком.
- `play_sound_from_entity(uuid, s)` — звук идёт за сущностью, на этом держатся плееры (`Музыка от коллуми`, `DNBS`). Стерео-звуки так не играют, сказано в описании.
- Разнообразие: `set_sound_pitch` со случайным числом вместо шести копий звука (`PvP`). Ещё `set_sound_volume_action`, `set_sound_source`, `set_sound_variation`, id текстом: `set_sound_type(s, "minecraft", id)`.
- `source: enum("BLOCK")` у действия (96 раз, 21 модуль) — старая форма, сейчас поле у звука: `sound(block.stone.break, source: block)`.

Мелодия нотными блоками: высота `2^((note−12)/12)`, `note` от 0 до 24.
```kotlin
process melody(at: location) {
    for note in [12, 16, 19, 24] {
        bell = set_sound_pitch(sound("block.note_block.bell", source: record), pow(2, (note - 12) / 12))
        @all play_sound(bell, at)
        wait(4)
    }
}
```
- `play_sound_sequence(звуки, место, задержка)`: до 43 звуков, задержка в тиках, при 0 один составной звук (`Отскок от стен`, `Звуки+`).
- Музыке ставь `source: record` или `music`: игрок убавит её сам, `stop_sounds_by_source(source: record)` снимет всю. `stop_sound()` глушит всё, `stop_sound(s)` один звук.

## Текст на экране
```kotlin
process type_line(line: text, color: text) {
    length = text_length(line)
    for i in 1..length {
        part = trim_text(line, 0, i)
        send_action_bar("${color}${part}")
        play_sound(sound("block.bamboo.fall", pitch: 1.5, volume: 0.3))
        wait(2)
    }
}
func progress(now: number, total: number) {
    full = round(now / total * 20)
    done = repeat_text("█", full)
    left = repeat_text("█", 20 - full)
    send_action_bar("&a${done}&8${left}")
}
```
- Экшн-бар живёт 3 секунды (60 тиков, код клиента): раза в секунду хватает, `wait(1)` (`Кастомный экшн-бар`) шлёт лишнее.
- Печать по буквам: `Диалоги через экшн-бар` (205 установок), `Action Bar PL`, пауза на `.`, `!`, `?`. Цвет отдельно: обрезка посреди `&c` покажет символы кода.
- Только подпись: `send_title(subtitle: "&7Текст", fade_in: 0, stay: 20)`, 68 вызовов в 28 модулях. Частый счётчик без `fade_in: 0` мигает. Умолчание клиента 10, 70, 20 тиков.

Босс-бар здоровья обновляется по событию, цикл не нужен. В модулях такого нет, только полоса своего здоровья раз в секунду (`Боссбар с информацией`).
```kotlin
const BOSS = "&cСтраж"
when entity_take_damage {
    if not @victim entity.name_equals(BOSS) {
        end_thread()
    }
    now = value.current_health - value.event_final_damage
    total = value.max_health
    if now > 0 {
        title = "${BOSS} &f${round(now)}"
        @all set_boss_bar("boss", title, now / total * 100, style: notched_10, color: red, sky_effect: dark_sky)
    }
}
when entity_death {
    if entity.name_equals(BOSS) {
        @all remove_boss_bar("boss")
    }
}
```
- Без `wait`: урон ещё не вычтен, поэтому вычитание. С `wait(1)` смертельный удар вернул бы полосу уже после `entity_death`.
- `sky_effect: dark_sky`, `fog`, `fog_and_dark_sky` — атмосфера без частиц (55 раз, 10 модулей).
- У полосы постоянный `id`: новый `id` — новая полоса. Каждый тик обновлять незачем (`AntiRelog`), хватит 5–20 тиков.

## Молния, вспышка, взрыв, фейерверк
| Эффект | Запись | Что важно |
|:--|:--|:--|
| молния напоказ | `@all display_lightning(место)` | не поджигает, 11 модулей |
| настоящая молния | `spawn_lightning_bolt(место)` | сущность мира, цель не нужна, не украшение: `код на молнии` бьёт каждый тик |
| вспышка | `@all display_particle(particle(flash, color: "#ffffff"), место)` | 22 раза, 11 модулей |
| взрыв напоказ | `particle(explosion_emitter)` и `sound(entity.generic.explode)` | без урона, 11 модулей |
| настоящий взрыв | `create_explosion(место, сила, fire: false, break_blocks: false)` | сила 0–4 |
| фейерверк | `launch_firework(ракета, место)` | `instant: true` взрывает сразу |

```kotlin
const ROCKET = item(firework_rocket, components: "{fireworks:{flight_duration:1b,explosions:[{shape:'large_ball',colors:[I;16711680],has_trail:true}]}}")
when player_kill_player {
    launch_firework(ROCKET, value.location)
}
```
В модулях ракета лежит копией из игры, `item("H4sI…")`. `when firework_explode` ловит взрыв.

## Экран игрока
Действия личные: всем — `@all`, жертве — `@victim`.

| Эффект | Запись |
|:--|:--|
| красная рамка | `set_world_border(value.location, 10000000, 100000)`, снять `remove_world_border()` |
| толчок от удара | `player.play_hurt_animation(180)`, угол 0–360 (`RealisticSP`) |
| тотем на экране | `play_animation_action(animation: totem)` |
| скример | `animation: jumpscare` или `particle(elder_guardian)` |
| мороз по краям | `player.set_freeze_ticks(100, ticking_locked: true)`, снять `0` и `false` |
| огонь без урона | `player.set_visual_fire(visual_fire: true)` |
| темнота | `give_potion_effect(potion(darkness, duration: 60), show_icon: false, particle_mode: none)` |
| ночь и дождь ему одному | `set_time(18000)`, `set_weather(weather_type: downfall)` |
| трещины на блоке | `send_break_animation(место, 5)`, стадия 0–10 |
| подсветка цели ему одному | `set_entity_glowing(uuid, color: red)` |
