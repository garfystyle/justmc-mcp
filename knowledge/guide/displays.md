# Визуализаторы

Сущности `spawn_text_display`, `spawn_block_display`, `spawn_item_display`: текст, блок и предмет в мире, которые можно двигать, крутить, растягивать и плавно анимировать. Встречаются в 124 из 1075 модулей.

Всё ниже измерено на сервере 04.11.2026 чтением метаданных из клиента, если не написано «из модулей». Числа в скобках у приёмов: сколько модулей так делают.

## Скелет

```kotlin
const LABEL = "shop_label"

func show_label(at: location, line: text) {
    entity_by_conditional(has_custom_tag("mod", LABEL))
    @current entity.remove()
    reset()
    spawn_text_display(at, LABEL, line)
    @last set_custom_tag("mod", LABEL)
    @last set_display_billboard(billboard_type: vertical)
    @last set_text_display_background("#000000", 0)
    @last set_text_display_text_shadow()
}

when world_start {
    entity_by_conditional(has_custom_tag("mod", LABEL))
    @current entity.remove()
    reset()
}
```

Три правила, из-за которых ломается большинство модулей:

- После спавна настраивай через `@last`. Без цели действие уйдёт игроку события и молча ничего не сделает. Поиск по постоянному имени сразу после спавна цепляет все старые копии (12 модулей).
- **Визуализаторы переживают `/build` и `/play`**: 87 из 87 остались. Уборка обязательна, иначе копии растут с каждым перезапуском. Метка и чистка в `world_start` надёжнее, чем надежда на `world_stop`.
- Обновляй `set_text_display_text`, а не удаляй и создавай заново: пересоздание мерцает.

## Что есть что

| | Точка спавна | Размер при 1 | Заметка |
|:--|:--|:--|:--|
| блок | **угол** блока, растёт в +x +y +z | 1×1×1 | центр: `set_display_translation(vec(-0.5, -0.5, -0.5))` |
| предмет | **центр** | блок-предмет 1×1×1 | |
| голова `player_head` | верх головы | 0.5×0.5×0.5, вниз от точки | на весь блок: размер 2.01, смещение y +0.501 (3 модуля) |
| текст | низ по центру | 1 пиксель шрифта = 0.025 блока | виден только спереди, с +z; сзади его нет вовсе |

Итоговое положение: место сущности с её `yaw` и `pitch`, затем матрица `смещение · левый поворот · размер · правый поворот`. Поэтому поворот сущности крутит модель целиком.

- `yaw` и `pitch` места спавна сущность перенимает. `entity.set_rotation(10, 120)` зажимает pitch до 90.
- Хитбокса нет: клик не поймать. Клик ловит `spawn_interaction_entity` рядом (раздел «Кнопка»).
- `is_mob()` у визуализатора ложь, `all_mobs()` его не видит, `all_entities()` видит, `mob_by_name` и `entity_by_name` находят. `entity_spawn` срабатывает и на него: в этом событии проверяй `is_mob()`.
- Имя ищется вместе с цветом: `spawn_text_display(p, "&cимя", …)` находится только по `"&cимя"`.
- **Выборка видит только загруженные чанки.** Текст на 240 блоков от игрока не нашёлся ни по имени, ни по тегу, и уборка его не сняла. Чистка в `world_start` бессильна вдали от игроков: ставь рядом с местом появления или убирай, пока игрок рядом.
- `while entity.exists()` работает и на выборке из нескольких: цикл идёт, пока жива хоть одна.
- Клиенту нужны только метаданные: `see` действие `displays` покажет всё ниже как есть.

## Значения аргументов

| Действие | Что записывается |
|:--|:--|
| `set_display_scale(vec)` | умолчание `set`. `mode: add` прибавляет. Отрицательный размер зеркалит, ноль разрешён |
| `set_display_translation(vec)` | то же; `mode: add` прибавляет, повторный вызов без него заменяет |
| `set_display_billboard()` | без маркера `fixed`. Есть `vertical`, `horizontal`, `center` |
| `set_display_brightness(блок, небо)` | зажато до 0–15. Без второго аргумента небо 0. `reset_display_brightness()` возвращает свет мира |
| `set_display_view_range(n)` | множитель, умолчание 1. 0 и 999 проходят |
| `set_display_shadow(радиус, %)` | радиус как есть, сила в процентах: 50 это 0.5. Без вызова тени нет |
| `set_display_culling_suze(ш, в)` | поля width и height как есть. 0 значит не отсекать |
| `set_display_glow_color("#ff0000")` | пишется и без `set_glowing()`, но контур виден только с ним. Сброс `reset_display_glow_color()` |
| `set_item_display_model_type()` | без маркера `none`. Есть `head`, `gui`, `ground`, `fixed` и руки |
| `spawn_block_display(p, имя, блок)` | годится `block(x)`, текст с состоянием `"oak_stairs[facing=east,half=top]"`, `"light[level=10]"` и предмет. Неверный id: ошибка, сущность не создаётся |
| `set_text_display_alignment()` | без маркера `center` |
| `set_text_display_text_shadow()`, `set_text_display_see_through()` | без маркера **включают**. Выключить: `enable_text_shadow: false` |
| `set_text_display_line_width(n)` | как есть, умолчание 200. 0 и 9999999 проходят |
| `set_display_teleport_duration(n)` | тики, **зажато до 59**: 60 и 100 дают 59 без ошибки |
| `set_display_interpolation(длит, задержка)` | тики, задержка без значения 0 |

## Текст

**Прозрачность.** `set_text_display_opacity(p)` хранит `4 + 2.55·p` одним байтом и переполняется:

| p | байт | На экране |
|--:|--:|:--|
| 0, 5 | 4, 16 | не виден |
| 9 | 26 | едва заметен, порог |
| 50 | 131 | полупрозрачный |
| **98** | 253 | **полностью виден, это максимум** |
| **99, 100** | 0, 3 | **текст исчезает** |

Значение `100` делает текст невидимым, а не непрозрачным. Поэтому модули зажимают его `clamp(…, 0, 95)`. Вернуть обычный вид можно только значением 98: сброса нет. Плавное появление: от 9 до 98.

**Фон.** `set_text_display_background("#ff0000", 50)`: цвет обязан быть с `#`, иначе `Указан невалидный HEX-цвет` и строка останавливается (`ff0000`, `&#ff0000`, `red`). `to_rgb(255, 0)` даёт `#FF0000`, его можно передавать прямо. Прозрачность в процентах: 0 убирает фон, 100 плотный. Умолчание Minecraft `#40000000`, вернуть: `reset_text_display_background()`. `("#000000", 0)` это не сброс, а отсутствие фона.

**Несколько значений.** `set_text_display_text(["a", "b"])` без маркера даёт `a b`. `separate_lines` две строки, `concatenation` слитно. `\n` в одной строке тоже переносит.

**Разметка.** `&c` и `mm"<red>…"` работают. `%player%` подставляется один раз при установке, и только там, где есть игрок: в процессе `no_target` останется буквами. `<sprite:…>` работает только в `mm"…"`, в обычном тексте остаётся буквами. Высота строки на экране: 10 пикселей, то есть 0.25 блока при размере 1.

## Поворот

`set_display_rotation_from_euler_angles(yaw, pitch, roll)` даёт кватернион `Rz(roll)·Rx(pitch)·Ry(yaw)`: это не ванильный порядок игрока. Углы в градусах.

| Маркер | Значение |
|:--|:--|
| `rotation` | без маркера `left_rotation`. Левый стоит снаружи размера: растянутая фигура поворачивается целиком. Правый стоит внутри: поворачивается до растяжения, получается перекос |
| `mode` | без маркера `set`. `add` умножает снаружи: поворот вокруг осей матрицы. `add_local` умножает внутри: вокруг собственных осей фигуры |
| `input` | без маркера `degrees`: `1.5708` даст полтора градуса. Радианы только с `input: radians` |

- `set_display_rotation_from_axis_angle(vec, угол)`: ось не обязана быть единичной, `vec(0, 0, 0.1)` равно `vec(0, 0, 1)`. Ось `vec(0, 0, 0)` сбрасывает поворот.
- `set_display_rotation_from_vector(направление, вверх)`: ось **+z** фигуры ложится на направление. Для снаряда: модель вытянута по z, направление из скорости. Направление вдоль `вверх` не ошибка.
- Матрица: `set_display_correct_transformation_matrix` читает **рядами** (смещение в 4, 8, 12 элементах). Старый `set_display_transformation_matrix` читает столбцами (смещение в последних), Xero предупреждает. Сервер разбирает матрицу на смещение, размер и поворот, поэтому `set_display_scale(mode: add)` после неё работает.
- `value.display_entity_left_rotation` и `..._right_rotation`: углы `XYZ` в **радианах**, вектором. Это не те же числа, что подаёт `yaw, pitch, roll`. Обратно через эйлер не подставлять: храни свои углы в теге. `value.display_entity_scale` и `..._translation`: вектор как есть.

## Плавность

Замер по `now.progress`, шаг 0.1 с:

| Хочу | Как | Что будет |
|:--|:--|:--|
| изменить размер, смещение, поворот, прозрачность текста, цвет фона | `set_display_interpolation(20, 0)` и изменение в том же тике | идёт ровно 20 тиков. Порядок двух вызовов неважен |
| ещё одно плавное изменение | **снова** вызвать `set_display_interpolation` | без повтора следующее изменение прыгает мгновенно |
| части, которые в этом кадре не меняются | **не** вызывать им `set_display_interpolation` | вызов без новой трансформации проигрывает старый переход заново: часть прыгает назад. Босс: стопа 0.93 блока за кадр |
| кадры подряд без пауз | длительность интерполяции на 1 тик больше шага кадра | опоздавший кадр иначе даёт видимую паузу |
| начать позже | `set_display_interpolation(20, 40)` | старт через 40 тиков, затем 20 тиков |
| плавно телепортировать | один раз `set_display_teleport_duration(20)` при создании, потом `entity.teleport` | сущность едет 20 тиков. Интерполяция на телепорт не влияет: 5 модулей из 8 ставят её зря |
| плавно повернуть сущность | тот же `set_display_teleport_duration`, потом `entity.set_rotation` | yaw шёл 0, 18, 36 … 90 за 20 тиков. Так крутят модель из частей: плавно и целиком |
| анимировать сразу после спавна | `wait(1)` между спавном и изменением | **в том же тике движения нет**: сразу конечный вид. Для телепорта и для интерполяции достаточно 1 тика |
| движение каждый тик | `teleport_duration` 1–3 и `entity.teleport` в цикле с `wait(1)` | догоняет плавно |

Правильная связка, её в модулях делают только три линии (КАСТОМ КЕЙСЫ и копии):

```kotlin
func open_case(at: location, prize: item) {
    spawn_item_display(at, "%player%_case", prize)
    last_entity()
    wait(1)
    for turn in 1..4 {
        @current set_display_interpolation(6, 0)
        @current set_display_rotation_from_axis_angle(vec(0, 1, 0), 90, mode: add)
        @current set_display_translation(vec(0, 0.25, 0), mode: add)
        wait(6)
    }
    wait(2s)
    @current entity.remove()
    reset()
    give_items(prize)
}
```

Интерполяция поворота идёт по кратчайшей дуге: за один шаг не больше 180°, поэтому полный оборот делай минимум в три шага.

## Привязка к сущности

`@last entity.ride_entity(uuid)` сажает на цель. Сидящие стоят в одной точке, у игрока на 1.8 выше ног, разводи их смещением.

- `entity.teleport` на сидящем визуализаторе **ссаживает** его.
- Смерть хозяина ссаживает все визуализаторы, они остаются на месте смерти. В `player_respawn` посади заново, после `wait(2)`.
- С `billboard: vertical` высота смещения честная. С `center` смещение поворачивается к игроку вместе со взглядом. Для подписей бери `vertical`, для меню перед лицом `center`.

```kotlin
const OWNER_TAG = "label_owner"

func label_up() {
    entity_by_conditional(has_custom_tag(OWNER_TAG, value.name))
    @current entity.remove()
    reset()
    spawn_text_display(value.eye_location, "%player%_label", "&e%player%")
    @last set_display_billboard(billboard_type: vertical)
    @last set_text_display_background("#000000", 0)
    @last set_text_display_text_shadow()
    @last set_display_translation(vec(0, 0.3, 0))
    @last set_custom_tag(OWNER_TAG, value.name)
    @last entity.ride_entity(value.uuid)
}

when player_join {
    set_nametag_visible(visible: false)
    label_up()
}

when player_respawn {
    wait(2)
    entity_by_conditional(has_custom_tag(OWNER_TAG, value.name))
    @current entity.ride_entity(value.uuid)
    reset()
}

when player_quit {
    entity_by_conditional(has_custom_tag(OWNER_TAG, value.name))
    @current entity.remove()
    reset()
}
```

Без событий игрока обходится сверка раз в секунду по тегу (КАСТОМНЫЙ НИК, 305 установок): она сама чинит всё после смерти и перезапуска. `entity_by_name(nick)` находит и самого игрока, поэтому фильтруй по тегу.

## Голограмма без сущности

`display_hologram(место, текст)` видит только цель, поэтому свой текст каждому не требует `hide_entity`. На клиенте это стойка с именем: на строку одна, `\n` даёт вторую. Новая голограмма на том же месте заменяет старую, пустой текст убирает. Настроек нет. После выхода показывай заново в `player_join` (12 модулей). Предел сервера 500 в мире.

```kotlin
func board_for_all(at: location, head: text) {
    all_players()
    for nick in value.selection_target_names {
        player_by_name(nick)
        @current display_hologram(at, "${head}\n&7${nick}")
    }
    reset()
}
```

## Таблица лидеров

`while entity.exists()` сам заканчивает процесс, если табличку убрали (Удобные лидерборды).

```kotlin
save coins: map

process top_board() {
    entity_by_name("top_coins")
    @current entity.remove()
    spawn_text_display(loc(0, 70, 0), "top_coins")
    last_entity()
    set_display_billboard(billboard_type: vertical)
    set_text_display_background("#000000", 30)
    set_text_display_text_shadow()
    set_text_display_line_width(300)
    while entity.exists() {
        top = sort_any_map(coins, sort_order: descending, sort_type: values)
        lines = create_list()
        place = 0
        for nick: score in top {
            place += 1
            if place > 10 {
                stop_repeat()
            }
            lines = append_value("&e${place}. &f${nick} &7- &6${score}")
        }
        set_text_display_text(["&6&lТоп", lines], merging_mode: separate_lines)
        wait(5s)
    }
}

when world_start {
    start top_board(target_mode: no_target)
}
```

Свой текст каждому: `entity.set_default_visible(default_visible: false)` на спавне и `hide_entity(имя, hide: false)` своему игроку. Вариант с `hide_entity` всем остальным хуже: вошедшие позже увидят чужое (из модулей).

## Полоса здоровья из текста

Цвет полосы задаёт фон, символы только занимают ширину: `"&l‌"` даёт 1 пиксель (Полосы здоровья, 607 установок). Левый край держится сдвигом на половину недостающей ширины: `percent * 0.00625 - 0.625`.

```kotlin
const CELL = "&l‌"

process bar_update() {
    wait(1)
    part = divide([@current value.current_health, @current value.max_health])
    percent = divide([part, 0.01], division_mode: round_to_int)
    green = lerp_number(0, 255, part)
    red = subtract([255, green])
    color = to_rgb(red, green)
    shift = vec(percent * 0.00625 - 0.625, 0.7, 0.01)
    fill = repeat_text(CELL, percent)
    entity_by_name("%selected_uuid%Bar")
    set_display_translation(shift, mode: set)
    set_text_display_text(fill)
    set_text_display_background(color, 75)
}
```

UUID хозяина в имени находит полосу без списков. Убирай в `entity_death` и `entity_removed_from_world`, иначе полоса останется от деспавна.

## Кастомный блок без ресурс-пака

Настоящий барьер даёт прочность и звук, поверх визуализатор. Яркость (15, 15) обязательна: внутри барьера свет 0, и модель чернеет. Имя-местоположение работает как ключ без списков.

```kotlin
func head_block(at: location, skin: item) {
    pos = align_location(at, rotation_mode: remove)
    entity_by_name(pos)
    @current entity.remove()
    reset()
    set_block(pos, block(barrier))
    spawn_item_display(pos, pos, skin)
    @last set_display_scale(vec(2.01, 2.01, 2.01))
    @last set_display_translation(vec(0, 0.501, 0))
    @last set_display_brightness(15, 15)
    @last set_custom_tag("custom_block", "on")
}

when player_break_block {
    pos = align_location(value.event_block_location, rotation_mode: remove)
    entity_by_name(pos)
    @current entity.remove()
    reset()
}
```

`align_location` с `rotation_mode: remove` даёт центр блока, значит блок-визуализатору ещё нужно `translation(-0.5, -0.5, -0.5)`, а предмету нет. Эпсилон от мерцания: размер +0.0005 или +0.01.

## Модель из частей

1. **Части в одной точке**, у каждой своё смещение и поворот, группа вращается `entity.set_rotation`: поворот сущности стоит снаружи матрицы, тригонометрия не нужна (Перекати-поле). Предел pitch 90.
2. **Части сидят на корне**: одно движение корня двигает всё. Корень: `spawn_interaction_entity` или `block(structure_void)`. Но помни: `entity.teleport` на части её ссаживает.
3. **Кадры**: один визуализатор, `set_item_model_data` по кадрам. Нужен ресурс-пак.

```kotlin
func part(at: location, id: text, look: block, shift: vector) {
    spawn_block_display(at, id, look)
    @last set_custom_tag("group", id)
    @last set_display_translation(shift)
}

func spin(id: text) {
    entity_by_conditional(has_custom_tag("group", id))
    angle = 0
    repeat 200 {
        if value.cpu_usage > 65 {
            stop_repeat()
        }
        angle += 5
        entity.set_rotation(angle, 0)
        wait(1)
    }
    entity.remove()
    reset()
}
```

Выбор группы один раз снаружи цикла: выборка держится через `wait`. Снос по одному тегу. Смотри на результат так: `screenshot` с `orbit` снимает модель со всех сторон, не двигая игрока.

## Модель с анимацией

Босс из 57 частей, проверено замером из клиента 05.11.2026. Части висят в одной точке, позы считаются заранее и лежат кадрами в списках.

- **Кадры считай снаружи.** Скелет и позы проще посчитать скриптом и записать в отдельный файл с `const`, чем крутить кватернионы в коде мира. Один кадр: у каждой части смещение, ось и угол.
- **Проигрывай только разницу.** Часть, которая в этом кадре не сдвинулась, в кадр не попадает: иначе старый переход проиграется заново.
- **Первый кадр клипа** может совпасть с прошлым значением, и клиент не начнёт переход. Добавь к смещению незаметную поправку, например `vec(0.002, 0, 0)`, и чередуй её знак.
- **Движение целиком:** `entity.teleport` у визуализатора и стойки ведёт себя наоборот названию маркера (6 прогонов в разном порядке, 07.11.2026):

  | Сущность | `keep_rotation: false` | `true` | без маркера |
  |:--|:--|:--|:--|
  | визуализатор, стойка | поворот **не** меняется | берётся из точки | берётся из точки |
  | моб с ИИ после `set_rotation` | не меняется | не меняется | не меняется |

  Нужный поворот клади в саму точку и маркер не пиши: одна команда вместо двух на каждую часть. Мобу поворот ставь `entity.set_rotation`. У игрока маркер другой: см. `world-blocks`.
- **Разность углов** считай `delta - 360 * floor((delta + 180) / 360)`. `warp` здесь не подходит: это не деление по модулю.
- **Положение игрока несёт его наклон.** Цель, взятая с `value.location`, сохраняет `pitch`, и `shift_location_in_direction` уводит модель в небо. Обнуляй: `set_coordinate(goal, 0, type: pitch)`.
- **Хитбокс** отдельным мобом: `spawn_mob`, `set_ai(ai: false)`, `set_silenced(silenced: true)`, эффект невидимости. Он не сидит на модели, а телепортируется тем же циклом, что и части. Здоровье моба упирается в 1024 молча.

```kotlin
const CLIP_STEP_TICKS = 2

game clip_frames: list

func play_clip() {
    for frame_index in 0..len(clip_frames) - 1 {
        apply_frame(clip_frames[frame_index])
        wait(CLIP_STEP_TICKS)
    }
}

func apply_frame(frame_poses: list) {
    for part_pose in frame_poses {
        entity_by_name(part_pose[0])
        @current set_display_interpolation(CLIP_STEP_TICKS + 1, 0)
        @current set_display_translation(part_pose[1])
        @current set_display_rotation_from_axis_angle(part_pose[2], part_pose[3])
    }
    reset()
}
```

Как проверить плавность: `see` действие `track` или шаг `track` в `test`. Он меряет каждую часть по кадрам и показывает рывки, откаты, паузы и сбросы интерполяции. Цифрами, а не на глаз. Снимки `screenshot` с `frames` показывают саму анимацию кадрами.

## Кнопка в мире

Визуализатор показывает, `spawn_interaction_entity` ловит (16 модулей). Хитбокс чуть больше видимого.

```kotlin
func button(at: location, title: text) {
    spawn_block_display(at, "knob ${title}", block(red_concrete))
    @last set_display_scale(vec(0.2, 0.2, 0.2))
    @last set_display_teleport_duration(3)
    hit = shift_all_coordinates(at, 0.1, 0, 0.1)
    spawn_interaction_entity(hit, title, 0.25, 0.25)
}

when player_right_click_entity {
    title = @victim value.name
    entity_by_name("knob ${title}")
    if entity.exists() {
        top = @current value.location
        down = shift_coordinate(top, -0.05, type: y)
        @current entity.teleport(down)
        wait(5)
        @current entity.teleport(top)
    }
    reset()
}
```

Меню перед лицом: текст на игроке, `center`, смещение `(-0.35, -0.45, -1.25)`, выбор строки `player_change_slot` с `cancel_event()`, остальным `hide_entity` (MENU-VISUALS).

## Снаряд и всплывающий текст

```kotlin
process pop_text(at: location, line: text) {
    spawn_text_display(at, "pop", line)
    last_entity()
    set_display_billboard(billboard_type: center)
    set_text_display_text_shadow()
    set_text_display_see_through()
    set_text_display_background("#000000", 0)
    set_display_teleport_duration(20)
    wait(1)
    up = shift_all_coordinates(at, y: 1)
    entity.teleport(up)
    wait(20)
    entity.remove()
}

when player_damage_entity {
    start pop_text(@victim value.eye_location, "&c-${value.event_damage}", target_mode: no_target)
}
```

Таблички урона в модулях нет ни одной, приём собран из всплывающего текста `zavod`. Снаряд: `set_display_teleport_duration(2)` один раз, цикл с `shift_location_on_vector`, `entity.teleport`, `game.block_equals` на столкновение, `wait(1)`. Направить модель по полёту: `set_display_rotation_from_vector`.

## Нагрузка

- 1200 текстов за 24 тика создались без отказа: CPU мира 21 %, TPS 20, уборка чистая. Предела корпус и сервер не показали, но рисует их каждый клиент: держи сотни, а не тысячи.
- Защиту от нагрузки ставят только 5 модулей: `if value.cpu_usage > 65`. Украшение при нагрузке пропускай, а не жди.
- `spawn` в цикле без порций упирается в общий бюджет тика, см. `server`.

## Как проверять

| Что | Чем |
|:--|:--|
| точное состояние | `see` действие `displays`, поля: `text`, `translation`, `scale`, `leftRotation`, `billboard`, `background`, `textOpacity`, `posRotInterpolationDuration`, `transformationInterpolationDuration`, `now` (текущая стадия анимации) |
| шаг сценария | `{"display": {"type": "text_display", "name": "x", "scale": [2, 2, 2], "billboard": "center", "count": 1}}` |
| как выглядит | `screenshot` с `camera` или `orbit`: игрок не двигается, на сервер ничего не уходит |
| изменения по времени | `see` действие `events`, `types: ["display_data", "display_move"]` |

Текст сзади не виден, поэтому снимай с +z или ставь `billboard`.

## Что не копировать из модулей

| Ошибка | Как надо |
|:--|:--|
| удалить и создать заново при обновлении (SimpleTimer, ТОП ПО КИЛЛАМ) | `set_text_display_text` |
| `set_display_interpolation` перед телепортом (VotingButtons, JMCS) | `set_display_teleport_duration` при создании |
| `set_display_billboard` без цели в `world_start` (Кто не знает) | `@last` |
| после `entity.remove()` работать с `@current` (Upravleniee) | `@last` |
| `forever` без `entity.exists()` (Планеты, Физика) | `while entity.exists()` |
| спавн `"air"`, потом блок: при ошибке остаётся пустой | блок сразу в спавн |
| `teleport_duration` в каждом шаге цикла | один раз |
| `wait(5)` перед анимацией нового | хватает `wait(1)` |
