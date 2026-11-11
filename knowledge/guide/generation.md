# Генерация мира и большие объёмы блоков
Дополняет `world-blocks`: порядок аргументов `set_region` и `clone_region`, `pace`, выделение и шар там. Числа 19/10: использований и модулей из 1075. Рецепты прогнаны на сервере 04.11.2026: 11 из 15, расхождения с кодом модулей исправлены здесь.
## Карта и большие постройки

- **Координаты зажимаются картой.** `loc()` сам ограничивает x и z размером мира (при размере 16 это ±256), y ±1000. `set_block(loc(1000, …))` и телепорт молча уходят на край, `get_block_material` читает зажатую точку и выглядит как успех. Проверяй клиентом: `see block`.
- Шум по дальним координатам вырождается в значение угла карты, ошибки не будет. Обход: `perlin_noise_3d(loc(x / 131072, 0, z / 131072), сид, частота * 131072, …)`, значения совпали бит в бит.
- `set_world_border` шире карты работает, но сервер всё равно вернёт игрока примерно на 255.6. В биоме `the_void` нет мобов и осадков.
- **Постройка планом.** Большой план не клади константой в код мира: мир больше 1 МБ тяжело обслуживать, а модуль ограничен 5 МБ. Режь на порции, ставь редкими объёмными вызовами с `wait`, сверяй снимком и разницей, план и команду стройки убирай из мира сразу после кладки.

## Шум
| Действие | Значение | Для чего |
|:--|:--|:--|
| `perlin_noise_3d(место, сид, частота, октавы, частота_октав, амплитуда)` 19/10 | −1…1 | высота, маски |
| `simplex_noise_3d(…те же…)` 6/3 | −1…1 | то же (GenLand, SGW) |
| `voronoi_noise_3d(место, сид, частота, смещение)` 2/2 | 0…1, ровные ячейки | резкие биомы, случайность по месту |
- Шум — действие, в формулу не входит: сначала `noise = perlin_noise_3d(…)`, потом `32 + noise * 14`.
- Третий аргумент — масштаб: чем меньше, тем шире холмы. В модулях: биомы, горы, реки 0.002–0.01, холмы 0.02–0.05. BetaGen и Simple Gen вместо него умножают координаты руками: пять лишних блоков на столбец.
- Октавы 1–8, в рельефе 3–5. `частота_октав` 2 и `амплитуда` 0.5 (GenLand): каждая октава вдвое мельче и вдвое слабее. Амплитуда больше 1 усиливает мелкие октавы, поверхность рвётся (BetaGen 5, SGW 1.75).
- Умолчания маркеров: у Перлина и симплекса `range_mode: full_range`, `normalized: true`, у Вороного `zero_to_one`. `normalized: false` выводит за ±1 (floating).
- Сид: `random_number(1, 1000000)` один раз, хранить в `save`. Каждому слою свой: `seed + 100`, `seed + 500` (GenLand). С одним сидом граница биома повторит очертания гор.
- Шум трёхмерный: для карты высот все столбцы берутся на одной Y.
## Рельеф столбцами
```kotlin
const SEA = 30
func pace() {
    steps += 1
    if steps >= 100 {
        steps = 0
        wait(1)
    }
    while value.cpu_usage >= 70 {
        wait(1)
    }
}
process terrain(first_corner: location, second_corner: location, seed: number) {
    on_grid(col, first_corner, second_corner) {
        noise = perlin_noise_3d(col, seed, 0.02, 4, 2, 0.5)
        height = floor(SEA + 2 + noise * 14)
        top = shift_coordinate(col, height, type: y)
        set_region(block(stone), col, top)
        set_region(block(dirt), shift_coordinate(top, -2, type: y), top)
        set_block(top, block(grass_block))
        if height < SEA {
            set_region(block(water), shift_coordinate(top, 1, type: y), shift_coordinate(col, SEA, type: y))
        }
        pace()
    }
}
```
- Запуск: `start terrain(loc(-128, 0, -128), loc(127, 0, 127), seed)`. Углы `on_grid` на одной высоте: один проход — один столбец, весь камень одним `set_region`. chunkgen собирает в список каждый блок столбца, floating ставит по блоку: шагов в десятки раз больше.
- Скорость решает порция. Мир 256×256 — 65 536 столбцов: BetaGen и GenLand ждут `wait(1)` на столбец, это 55 минут, floating ждёт 3 тика. Порция 100 столбцов — полминуты. Предела в данных нет, поэтому порция всегда вместе с `value.cpu_usage`.
- Грубая сетка: `for x in lo..hi step 4`, шум раз на плитку 4×4, `set_region` на плитку (BeseniGenv3). Шума в 16 раз меньше, рельеф ступенями.
- `send_action_bar` на столбец (BetaGen, SGW, floating) зря тратит действие, прогресс нужен раз в секунду. То же `@all entity.remove()` в цикле (Simple Gen).
- Очистка до генерации срезами (Simple Gen). `clear_region` на всю высоту в каждом столбце (GenLand) в разы дороже. Границы: `value.world_size` в чанках, X и Z ±размер×16, Y −64…319 (Plots, Gen_Doseda).
- Поверхность готового мира одним действием: `ray_trace_result(variable_for_hit_block_location: ground, start: set_location_direction(sky, vec(0, -1, 0)), max_distance: 400, ray_size: 0, ray_collision_mode: only_blocks)`. CaseGen и Herobrine спускаются циклом с `location_in_block`, шаг на блок. В своём мире высоту считают из шума заново, блоки не читают.
## Формы рельефа
| Что | Формула | Откуда |
|:--|:--|:--|
| горы среди равнин | маска `mask = (second_noise + 1) * 0.5` на частоте 0.002, `height = plain * (1 - mask) + mount * mask` | GenLand |
| острые пики | `pow(abs(noise), 2) * 80` | GenLand |
| река | `river = 1 - abs(noise)`, при `river > 0.85`: `height -= (river - 0.85) / 0.15 * 6` | GenLand |
| редкие глубокие моря | `height -= 15 / (1 + pow(5, 2 - second_noise * 10))` | Simple Gen |
| летающие острова | столбец есть при `noise > 0.24`, толщина `noise * 5` | floating |
| пятна в объёме | 3D-шум `zero_to_one`, `floor(noise * len(палитра))` — индекс блока | VTools |
| пещеры | 3D-шум, при `abs(noise) < 0.08` воздух | в модулях нет |

`second_noise` — второй шум со своим сидом.
## Биомы
```kotlin
const TOPS = ["sand", "grass_block", "podzol", "snow_block"]
func biome(col: location, seed: number) {
    noise = perlin_noise_3d(col, seed + 500, 0.01, 2, 2, 0.5)
    return clamp(round(noise * 2.7 + 1.5), 0, 3)
}
```
- Биом это индекс, всё остальное берётся по нему: `TOPS[biome(col, seed)]`. Simple Gen сравнивает блок поверхности в трёх функциях по 60 строк.
- Значения шума жмутся к нулю: равное деление почти всё отдаёт средним биомам. Simple Gen растягивает `t * 2.7` и режет `clamp`. Края списка всё равно реже, туда идёт самый редкий биом.
- Резкие края: `voronoi_noise_3d(col, seed, 0.02)` даёт ячейки с одним значением (BetaGen).
- Настоящий биом Minecraft не задать: действий нет, цвет травы не изменить. Биом виден только по блокам и растениям.
## Случайность, деревья, руда
```kotlin
const ORE = block(iron_ore)
func vein(center: location) {
    replace_blocks_in_region(center, center, ORE, block(stone))
    adjacently(neighbor, center, include_self: false, pattern: cube) {
        if random_number(1, 2) == 1 {
            replace_blocks_in_region(neighbor, neighbor, ORE, block(stone))
        }
    }
}
func flora(top: location, seed: number) {
    roll = voronoi_noise_3d(top, seed + 7, 1)
    if roll < 0.02 {
        generate_tree(shift_coordinate(top, 1, type: y), tree_type: birch)
    } else if roll < 0.1 {
        bone_meal_block(top, 1)
    }
}
```
- `random_number` даёт новый мир при каждом запуске. Если сид обязан повторять мир, бери Вороного с частотой 1. Gen_Doseda меняет ещё и сид по координатам: `voronoi_noise_3d(p, (y * 320 + z) * size + x + seed, 1)`.
- `generate_tree(место, tree_type: …)` 34/11: место над опорой, умолчание `tree`. Почва не нужна: дерево выросло и на стекле (проверено, gn05). Плотность в модулях 1–5 % столбцов. Тип это маркер, его можно передать переменной: `tree_type: kind`.
- Деревья — вторым проходом по готовому рельефу: иначе соседний столбец срежет крону.
- `bone_meal_block(дёрн, 1)` растит траву и цветы вокруг (5 модулей): один вызов вместо списка на 40 растений.
- `replace_blocks_in_region(center, center, руда, block(stone))` меняет только камень, жила не вылезет в воздух и воду (Simple Gen).
- У `adjacently` умолчания: `include_self` включён, `pattern: cardinal`.
- Вес вариантов: пороги `roll`, а не список из 90 повторов (Simple Gen). Семь `start` на столбец (BetaGen) грозят `too_many_processes_active`, здесь нужны функции.
## Структуры
```kotlin
const TEMPLATE_START = loc(200, 5, 200)
const TEMPLATE_END = loc(210, 15, 210)
const LOOT = [item(diamond), item(iron_ingot, 3), item(golden_apple)]
func stamp(to: location) {
    clone_region(TEMPLATE_START, TEMPLATE_END, TEMPLATE_START, to, ignore_air: false, copy_entity: false)
}
func dungeon(center: location) {
    first_corner = shift_all_coordinates(center, -3, -1, -3)
    second_corner = shift_all_coordinates(center, 3, 3, 3)
    set_region(block(mossy_cobblestone), first_corner, second_corner)
    clear_region(shift_all_coordinates(first_corner, 1, 1, 1), shift_all_coordinates(second_corner, -1, -1, -1))
    set_block(center, block(spawner))
    set_spawner_entity(center, item(zombie_spawn_egg))
    box = shift_coordinate(center, 2, type: x)
    set_block(box, block(chest))
    repeat 5 {
        set_item_in_container_slot(box, get_list_random_value(LOOT), random_number(1, 27))
    }
}
```
- Образец в мире проще кода: строится руками вне игровой зоны, правится без заливки (Plots).
## Инструменты в духе WorldEdit
| Команда | Как | Откуда |
|:--|:--|:--|
| `copy`, `paste` | `copy` запоминает `value.location`, `paste`: `clone_region(pos1, pos2, точка, value.location)` | 31 модуль |
| `walls`, `outline` | 4 или 6 `set_region` по граням | Gen_Doseda, gay |
| `hsphere` | два радиуса | worldedit |
| `move`, `stack` | `clone_region` и `clear_region` источника; `clone_region` в цикле со сдвигом | в модулях нет |
| `count` | `on_grid` и `game.block_equals(блоки, point)` | Gen_Doseda |
| `distr` | `kind = get_block_material(point)`, `counts[kind] += 1` | Gen_Doseda, иначе |
| кисть | `ray_trace_result` от глаз, шар вокруг точки | `: ᴘᴇᴀᴄᴇ :`, иначе |
```kotlin
func shell(center: location, radius: number, shell_block: block) {
    low = shift_all_coordinates(center, -radius, -radius, -radius)
    high = shift_all_coordinates(center, radius, radius, radius)
    on_grid(point, low, high) {
        if location_is_near(point, radius + 0.5, center) and not location_is_near(point, radius - 0.5, center) {
            set_block(point, shell_block)
        }
    }
}
func walls(first_corner: location, shell_block: location, wall_block: block) {
    get_all_coordinates(first_corner, x1, y1, z1)
    get_all_coordinates(shell_block, x2, y2, z2)
    set_region(wall_block, first_corner, loc(x2, y2, z1))
    set_region(wall_block, loc(x2, y1, z1), shell_block)
    set_region(wall_block, shell_block, loc(x1, y1, z2))
    set_region(wall_block, loc(x1, y2, z2), first_corner)
}
func mix(first_corner: location, shell_block: location, parts: map) {
    all = create_list()
    on_grid(point, first_corner, shell_block) {
        all = append_value(point)
    }
    all = randomize_list_order(all)
    from = 0
    for id: percent in parts {
        to = round(from + len(all) * percent / 100)
        cut = trim_list(all, from, to)
        set_block(cut, id)
        from = to
    }
}
```
- `mix(first_corner, second_corner, {"stone": 70, "andesite": 30})` даёт точные доли (Gen_Doseda). `get_list_random_value` на блок проще, доли плавают.
- `on_sphere` выдаёт точки поверхности, при малом числе точек остаются дыры (WorldEdit 0.1 берёт 8000 на слой). Точная форма: `on_grid` с `location_is_near`.
- `paste` в 31 модуле копирует не буфер, а место: источник поправили — вставится новое. Настоящий буфер — снимок, как в отмене.
- Блок текстом из чата: неверный id останавливает строку ошибкой `Ожидал аргумент "Блок" с типом Блок, но получил Текст` (проверено, gn07). Перед установкой лови её `exception`.
- Команды: словарь команда → имя функции и `call(имя)` (worldedit, Gen_Doseda), а не обработчик на команду (Worldedi).
- `set_block(список, блок)` принимает переменную-список: «до 14» в справочнике это клетки сундука. chunkgen, EditSession и Gen_Doseda ставят так тысячи мест одним действием. Предел списка 20 000: EditSession сбрасывает ровно на нём, Gen_Doseda режет по 48 000 и упрётся в ошибку. Шаги приём не экономит, `append_value` стоит шаг на блок: он нужен, когда места уже собраны (отмена, доли).
## Отмена и повтор
| Способ | Плюсы | Минусы |
|:--|:--|:--|
| снимок `clone_region` в запасной участок | 2 действия на объём, поворот сохраняется | нужен свободный участок; в модулях нет |
| словарь `id_with_data` → места (Gen_Doseda) | любая форма: шар, кисть | шаг на блок, сундуки пустеют, списки до 20 000 |
| два параллельных списка (WorldEdit+) | просто | `set_block` на каждый блок, один шаг отмены |
```kotlin
const STORE = loc(0, 250, 0)
game `undo from %player%`
game `undo to %player%`
func snapshot(first_corner: location, second_corner: location) {
    `undo from %player%` = first_corner
    `undo to %player%` = second_corner
    clone_region(first_corner, second_corner, first_corner, STORE, ignore_air: false, copy_entity: false)
}
func undo() {
    if not var.exists(`undo from %player%`) {
        return
    }
    first_corner = `undo from %player%`
    size = get_vector_between_locations(first_corner, `undo to %player%`)
    store_end = shift_location_on_vector(STORE, size)
    clone_region(STORE, store_end, STORE, first_corner, ignore_air: false, copy_entity: false)
    purge(["undo from %player%", "undo to %player%"])
}
```
- `ignore_air: false` обязателен: иначе отмена не сотрёт поставленное на месте воздуха.
- Большую область режут как `set_region`. Третий и четвёртый аргументы у всех кусков одни, они задают сдвиг (worldedit, `WE PartSetAction`).
- Несколько шагов и игроков: у снимка свой участок, `STORE` со сдвигом по номеру.

Словарь для неровных форм:
```kotlin
game `undo %player%`: list
func capture(first_corner: location, second_corner: location) {
    ids = create_list()
    on_grid(point, first_corner, second_corner) {
        id = get_block_material(point, value_type: id_with_data)
        if not id in ids {
            ids = append_value(id)
            `места %var_local(id)` = create_list()
        }
        `места %var_local(id)` = append_value(point)
    }
    taken = create_map()
    for id in ids {
        taken[id] = `места %var_local(id)`
    }
    return taken
}
func undo() {
    last = len(`undo %player%`) - 1
    if last >= 0 {
        snap = `undo %player%`[last]
        `undo %player%` = remove_list_value_at_index(gone, `undo %player%`, last)
        for kind: places in snap {
            set_block(places, kind)
        }
    }
}
```
- Правка: `` `undo %player%` = append_value(capture(a, b)) ``, потом `set_region`. Повтор: перед восстановлением положи `capture` в список `redo`, новая правка его очищает.
- Локальные общие с функцией: если `capture` пишет в `snap`, снимок в `undo` подменится и отмена вернёт то же самое. Имена внутри разные.
## Долгая операция: прогресс, стоп, одна за раз
```kotlin
game `занят %player%`
game `стоп %player%`
process bar() {
    while running == 1 {
        wait(10)
        percent = floor(done * 100 / total)
        set_boss_bar("gen", "Готово ${percent}%", percent, style: notched_20, color: green)
    }
    remove_boss_bar("gen")
}
process work(first_corner: location, second_corner: location) {
    running, done, total = 1, 0, 4096
    start bar(local_variables_mode: share)
    on_grid(point, first_corner, second_corner) {
        if `стоп %player%` == 1 {
            break
        }
        set_block(point, block(stone))
        done += 1
        if remainder(done, 1000) == 0 {
            wait(1)
        }
    }
    running = 0
    purge(["занят %player%", "стоп %player%"])
}
```
- Команда запуска: при `` `занят %player%` != 1 `` поднять флаг и `start work(…)`. Команда стоп: `` `стоп %player%` = 1 ``.
- Бар в процессе с общими локальными: цикл не тратит шаги на вывод (worldedit `WE RPT`, Gen_Doseda `We.operationTick`). Там же процесс обнуляет счётчик каждый тик, и `wait` срабатывает на 5000 шагов за тик, а не на каждые 5000.
- Без флага GenLand останавливается только `/build`, модуль сам об этом предупреждает.
- `server_stopped_time` и `action_count_per_tick` из worldedit и MAPI сервер отдаёт пустыми, ждать по ним нельзя. Рабочие: `value.cpu_usage`, `value.server_tps`.
## Поворот
```kotlin
func rotate(first_corner: location, second_corner: location, to: location, angle: number) {
    on_grid(point, first_corner, second_corner) {
        if game.block_equals("air", point) { continue }
        data = get_block_material(point, value_type: id_with_data)
        offset = rotate_vector_around_axis(get_vector_between_locations(first_corner, point), angle, axis: y)
        if text_contains(data, "facing=") {
            old = get_block_data(point, "facing")
            if old != "up" and old != "down" {
                face = rotate_vector_around_axis(get_vector_from_block_face(old), angle, axis: y)
                new = vector_to_direction_name(face)
                data = replace_text(data, "facing=${old}", "facing=${new}")
            }
        }
        set_block(shift_location_on_vector(to, offset), data)
    }
}
```
- Приём rotateArea упрощён: центр поворота — угол `first_corner`, вектор целый. Модуль вращает вокруг середины области, вектор дробный, поэтому там есть режим округления. Углы только кратные 90, иначе в копии дыры.
- `axis: y` обязателен, умолчание `x`. `get_block_data` читает состояние и у обычных блоков, хотя справочник пишет о блоках-сущностях (6 модулей).
- При 90 и 270 меняются ещё `axis=x` и `axis=z` у брёвен и `east=…` у заборов: rotateArea пересобирает их вторым проходом.
## Частые ошибки
- Весь мир прямо в `player_chat`: у строки события свой предел времени, тяжёлое выноси в `start`.
- Список больше 20 000 значений, словарь больше 10 000: ошибка останавливает строку на полпути, мир остаётся изменён частично.

Луч вниз `ray_trace_result` отдаёт точку на верхней грани: высота на 1 больше y блока (gn03: столб до 17, точка 18). Поворот области на 90 через `rotate_vector_around_axis` рецепт gn11 не подтвердил: вектор стал `(0, -3)`, стекло легло не там, где ждали. Перед поворотом проверяй знак на своём случае.
