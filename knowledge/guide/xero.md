# Язык Xero: полный справочник записи

Формы и сообщения сняты запусками компилятора (ядро 0.1.0-beta). Сервер — `start` и темы, имена — `find`.

## Файл

Снаружи тел только `import`, `const`, объявления, `when`, `func`, `process`, пометки, в любом порядке: `func` и `const` видны и выше объявления.

- Команда кончается переводом строки; две в строке — через `;`, после `}` тоже. В `() [] {}` переносы свободны, запятая в конце разрешена, вне скобок рвут только после оператора.
- `{` и `else` могут быть на новой строке. Скобки вокруг условия можно, у `for` нельзя. Комментарии `//`, `/* */`.
- Имя: буквы (и кириллица), цифры, `_`, иначе `` `монеты %player%` ``, `` `for` ``, у `const` тоже.
- Заняты `when func process start import if else not and or for while repeat forever break continue return _`. Слова есть и по-русски (`когда`, `если`, `и`, `в`, `не`). `for = 1`, `и = 1` собираются с предупреждением `слово языка`, правка — кавычки. Счётчик `и`, `в` не заводи.

## Переменные

```kotlin
game round
save `монеты %player%`
save stats: map
game queue: list

when player_join {
    x = 1
    line counter = 2
    game hits = 0
    health, extra = value.current_health, 2
    save first, second = 1, 2
    `монеты %player%` += 5
    game.hits += 1
    send_message("${x}${counter}${health}${extra}${first}${second}${round}${save.second}${stats}${queue}")
}
```

- Вид локальной объявляется внутри тела: `line items: list`, можно сразу со значением: `line items: list = [1, 2]`.
- Без слова — локальная. `line x` действует в своём обработчике на всю его длину, в другом то же имя другое. Параметр — `line`, его можно менять.
- Слово области пишут один раз, оно действует на имя во всём проекте, даже выше. Две области у имени — ошибка.
- Снаружи только без значения: `save x`, `save m: map`. Так объявляют и то, что задаёт другой код. Вид: `map`, `list`, `array`, `location`, `vector`, `number`, `text`, `item`, `block`, `sound`, `particle`, `potion`.
- `game.x`, `save.x`, `local.x`, `line.x`, ``game.`a b` `` — область на месте, ничего не объявляет: для имени в двух областях.
- `true` = 1, `false` = 0, `PI`, `E` — числа; своя переменная важнее. `null` нет.
- `const X = значение`: подставляется при сборке, менять нельзя, только снаружи тел. Годятся литералы, `item(…)` и прочие значения, другая `const`, индекс, `len`, арифметика. Не годятся `value.x`, переменная, `{a: 1}` с голым ключом. Работает везде: `L[0]`, `M["k"]`, `len(L)`, `name: N`, `lore: LORE`, `tags: TAGS`, `"${N}"` в этих полях. `L[i]` с переменной — блок. Параметр с тем же именем её закрывает.

## Операторы

От слабых к сильным: `?:`, `or`, `and`, `not`, сравнение и `in` (без цепочек), `+ -`, `* / %`, унарный `-`, индекс. `= += -= *= /= %=` — только командой, `a, b =` — только `=`. Нет: `.5 1e3 0x10 1_000 ** ^ ++`.

## Текст

`"&aтекст"` = `legacy"…"`, `mm"<red>…"`, `plain"…"`, `json"{…}"`; приставка слитно. Экранируются `\"`, `\\`, `\$`, `\uXXXX`; `\n` уходит как есть, это перенос. Одинарных кавычек, переноса внутри кавычек и склейки `+` нет.

`${…}` — одно выражение: переменная, формула, значение с целью и без, индекс, `len(l)`, вызов с результатом, условие (1 или 0), `?:`. `${item(…)}`, `${loc(…)}`, `${[…]}`, `${v * 2}` с вектором — +1 блок. Нельзя `${}`. В имени переменной не работает: там плейсхолдер `` `%var_local(n)_x` ``. **Параметр функции в имени и в тексте только `%var_line(n)`**: `%var_local` и `%var` дают `0`, и переменная молча получает имя `x 0` (проба 07.11.2026), `check` об этом предупредит. Объявление сравнивается по тексту имени: `` `x %var_line(winner)` `` и `` `x %var_line(person)` `` это два разных объявления, второе без своего `game` станет локальной. Плейсхолдеры пишут прямо в текст: `%player%`, `%var(x)`, `%math(x+1)`; у функций нет хвостового `%`.

## Значения

```kotlin
const SWORD = item(diamond_sword, 2, name: "&bМеч", lore: ["строка", "&6вторая"],
    enchantments: {sharpness: 5, "minecraft:unbreaking": 3}, unbreakable: true,
    damage: 3, glint: true, model: 7, hide_tooltip: true,
    tags: {kind: "hero", lvl: 5}, components: "{max_stack_size:1,rarity:'epic'}")

when player_join {
    all = [SWORD, block(stone), vec(0, 1, 0),
        loc(1, 64, 2), loc(1, 64, 2, 90, 45), loc(x: 1, y: 64, z: 2, pitch: 45),
        sound(entity.player.levelup, volume: 1, pitch: 2, variation: "", source: master),
        particle(flame, count: 3, first_spread: 0.5, second_spread: 0.5, y_motion: 0.1),
        particle(dust_color_transition, color: "#ff0000", to_color: "#00ff00", size: 2),
        particle(falling_dust, material: sand),
        potion(speed, amplifier: 1, duration: 30s)]
    send_message(all)
}
```

- `item`: количество 1–99, вторым или `count:`. `lore:` — строка или непустой список. Чары 1–255. `unbreakable:`, `hide_tooltip:` только `true` (иначе не пиши поле), `glint:` оба. `damage:` от 0. В `tags:` значение — текст или число. `components:` — SNBT строкой, не дублирует поля. `item("H4sI…")` — готовый стек, других полей нет.
- Id: `stone`, `"stone"`, `"minecraft:stone"`; голое `minecraft:stone` нельзя, цифра после точки только в кавычках: `sound("music_disc.13")`.
- `block(id)` — только id блока. Поля значения не читаются: `get_coordinate(l, type: x)`.
- `source`: `master music record weather block hostile neutral player ambient voice ui`.
- Движение частицы (`x_motion`…), цвет, размер, материал только там, где положены: лишнее поле не уходит, предупреждение `у этой частицы нет цвета`.
- Зелье: `amplifier` 0 — первый уровень, `duration` −1 (умолчание) бесконечно.

**Переменные берут** `loc`, `vec`, `[…]`, `{…}` (+1 блок). В `item`, `block`, `sound`, `particle`, `potion` всё постоянное: числа и текст — литерал или `const`, переменная в id читается как id. По ходу игры меняют действием:

```kotlin
when player_join {
    amount = 5
    stack = set_item_amount(item(stone), amount)
    stack = set_item_name(stack, "&bМеч ${amount}")
    stack = set_item_custom_tag(stack, "kind", "hero")
    give_items(stack)
    give_items(item(stone), amount)
    give_potion_effect(set_potion_effect_duration(potion(speed), amount * 20))
    play_sound(set_sound_pitch(sound(ui.button.click), amount / 10), value.location)
    display_particle(set_particle_amount(particle(flame), amount), value.location)
}
```

Ещё `set_item_lore`, `set_item_type`. Время — это число: `5s 500ms 20t 1m30s 2h 1d`, `5с 500мс 20т 1м30с 2ч 1д`, ещё `сек мин час тик`; слитно, `5sec` нельзя. `x = 5s` даёт 100 тиков, `wait(2s, seconds)` — 2. Голое число в `wait` — тики. Нецелые тики — ошибка: `wait(10ms)`.

## Списки, словари, индексы

```kotlin
save data: map

when player_join {
    step = 1
    numbers = [10, step, _, "%player%"]
    profile = {"hp": 20, "имя": value.name, step: [1, 2]}
    x = numbers[1]
    numbers[0] = 5
    numbers[2] += 1
    profile["hp"] = profile["hp"] - 5
    grid = [[1, 2], [3, 4]]
    grid[1][0] = 9
    data[value.name] = numbers[step + 1]
    first = value.selection_target_names[0]
    send_message("${numbers[0]} ${profile["hp"]} ${grid} ${len(numbers)} ${first} ${x}")
}
```

- `_` — дырка, хвост дырок отбрасывается. Индекс с нуля, бывает у переменной, значения, вызова, не у литерала.
- **Ключ словаря — выражение:** `{hp: 1}` ищет переменную `hp`. Голые слова понимают только `enchantments:` и `tags:`.
- Вид для `x[k]`, `k in x` берётся из ключа, присваивания `[…]`, `{…}`, `create_list`, `create_map`, `for`, вида параметра, объявления.
- `len(x)` — переменная, постоянная (число при сборке), `value.x`, индекс, вызов (+1 блок). Длина текста — `text_length(t)`.

## Условия

```kotlin
when player_join {
    level = 2
    levels = [1, 2]
    if level == 1 {
        wait(1)
    } else if not level > 5 and is_sneaking() {
        wait(2)
    } else {
        wait(3)
    }
    if level in [1, 2] or level in 5..9 or level in levels and level not in [7] { wait(1) }
    ok = level > 1 and level < 9
    if not ok { wait(1) }
    big = level > 3 ? "да" : "нет"
    has = has_item(item(diamond))
    send_message("${big} ${has} ${level > 1}")
}
```

- Условие: `== != > >= < <=`, `in`, проверка вызовом (скобки обязательны), флаг, `not and or`.
- `in` справа: `[…]`, `a..b` (концы включены), список, словарь (ключ).
- `if ok` значит `ok == 1`; если известно, что это число или текст, — ошибка.
- Постоянное условие (`if DEBUG`, `if true`) сворачивается, тело проверяется. В `and`, `or` постоянное нельзя.
- «… по условию» (`player_by_conditional(…)`): одно условие, `not` и цель можно; `x == 1 or x == 2` над одной переменной — один блок, как `x in [1, 2]`; другие `and`, `or`, вызовы функций, индексы нельзя. Тела нет.

## Циклы

```kotlin
when player_join {
    numbers = [1, 2]
    x = 0
    repeat 3 { wait(1) }
    for i in 1..10 { wait(1) }
    for j in 10..0 step -2 { wait(1) }
    for element in numbers { send_message("${element}") }
    for index, element in numbers { send_message("${index}${element}") }
    for key: val in {"a": 1} { send_message("${key}${val}") }
    while value.cpu_usage > 50 { wait(1) }
    forever {
        wait(20)
        if x > 7 { break }
        x += 1
        continue
    }
    on_sphere(point, loc(0, 64, 0), 5, 100) { send_message("${point}") }
    exception(err) { send_message("${err}") }
    measure_time(elapsed, duration: milliseconds) { wait(1) }
    label("имя") { break_label("имя") }
    send_message("${elapsed}")
}
```

Прочие циклы и контроллеры — действия с телом, переменная точки — первый аргумент. `break`, `continue` только внутри цикла. `return` в `when`, `process` кончает срабатывание.

## Действия

- Позиционные — по порядку сундука, за ними настройки; именованные где угодно.
- Категория обязательна, если имя в нескольких: `player.teleport`, `entity.remove`, `var.remove`, `var.exists`, `repeat.while`, `var.value`. Категории: `player entity game var select repeat control controller`.
- Маркер: `wait(1, seconds)`, `time_unit: seconds`, `"seconds"`, `const`. Переменная: `time_unit: u`, `tree_type: t`, `wait(1, u)`; переменная с именем варианта уступает варианту. Свой запасной вариант: `enum("SECONDS", u)`.
- Множественный аргумент: `send_message("a")`, `send_message(["a", n])`, блока не требует.
- `_` — пустая клетка, в слотовом аргументе пустой стек; посреди сетки обязателен, хвост дополняется сам.
- `x = действие(…)`: `x` занимает аргумент-переменную. Дописать в список: `append_value(l, 5)` = `l = append_value(l, 5)` = `l = append_value(5)`, несколько — `append_value(l, [5, 6])`.
- Правка на месте без `x =`: `remove_list_value(l, 1)` = `l = remove_list_value(l, 1)`. Так же `remove_list_value_at_index(l, 1)`, `insert_list_value`, `set_list_value`, `trim_list`, `sort_any_list`, `reverse_list`, `remove_map_entry(m, k)`, `set_map_value`, `sort_any_map`, `set_item_lore(x, "t")`. Куда положить удалённое — только по имени: `removed_value: r`.
- Действие с результатом — значение в аргументе, тексте, формуле (+1 блок). С телом нельзя.

Слоты: «Текст» берёт всё, «Число» — текст с числом или `%`, «Предмет», «Звук», «Вектор», «Частица» — текст, «Блок» — текст и предмет, «Местоположение» — только себя. Неверный литерал — ошибка, неверная переменная — предупреждение.

## Цели

| Куда | Запись | Цели |
|:--|:--|:--|
| действие игрока | `@killer give_items(…)` | `current default killer damager shooter victim random all` |
| действие сущности | `@last entity.remove()` | те же, `projectile all_mobs last`; `all` — все сущности |
| условие, результат | `if @x c()`, `not @x c()`, `else if @x c()`, `while @x c()`, `player_by_conditional(@x c())`, `y = @x player.get_nbt()` | как у действия |
| значение | `x = @killer value.name` | `current default default_entity killer damager victim shooter projectile last` |
| формула, `${}` | `@killer value.food_level + 1`, `"${@x value.name}"` | те же, +1 блок |

- Цели нет у функций, `wait`, действий с переменными, присваивания, переменных, `loc`. `@last` только у `entity.*`.

## Функции и процессы

```kotlin
func kit(
    amount: number "Сколько выдать" = 1,
    who = "все",
    lines: text[3] "Строки" = _,
    mode: enum("alpha", "beta") "Режим" = "beta",
    `Иконка предмета`: item = item(stone),
) {
    send_message("${amount}${who}${mode}${len(lines)}${lines[0]}")
    give_items(`Иконка предмета`)
}

func plus(left, right) {
    return left + right
}

process tick(delay = 1) {
    forever {
        wait(delay)
    }
}

when player_join {
    kit()
    kit(2, "я", ["а", _, "б"], "alpha")
    chosen_mode = "beta"
    kit(mode: chosen_mode, lines: "одна")
    total = plus(2, 3) + plus(1, 1)
    if plus(total, 1) > 5 { send_message("Итого ${plus(total, 1)}") }
    start tick(20, target_mode: no_target)
    start tick(delay: 5, local_variables_mode: copy)
    start call("tick", delay: 2, target_mode: no_target)
    call("Игра", level: 1)
}
```

- Параметр: `имя: вид "описание" = умолчание`, части необязательны, порядок строгий. Описание без `${}`, приставки можно.
- Вид: `any text number location loc vector vec block item sound particle potion array list map variable enum("a", "b")`.
- Без `=` обязателен, `= _` — необязательный пустой. Умолчание без блоков: вызов, индекс, условие нельзя. Параметров до 27.
- `lines: text[3]`: до 53 клеток, вид обязателен, в вызове список или одно значение, внутри список.
- `enum`: без `=` — первый вариант; в вызове текст, слово варианта или переменная.
- Имя действия занято, кроме как в кавычках: `` `wait`() `` — функция, `wait(1)` — действие. Имя с точкой пишут как есть, и с категорией: `func Mapi.load()`, `func player.x()`, `player.x()`.
- Функция не из файла: `` `Имя`(level: 1) ``, только по имени, значения не даёт.
- `return значение` не смешивают с голым `return`. Вызов — значение где угодно. Процесс значения не возвращает, `start` только со скобками.
- `local_variables_mode`: `dont_copy` (умолчание), `copy`, `share`. `target_mode`: `current_target` (умолчание), `no_target`, `current_selection`, `for_each_in_selection`. Голым словом.

## Что во что собирается

| Запись | Блоки |
|:--|:--|
| `x = a * 2 + b`, `x = -a` | 1, `%math`; из постоянных считается при сборке |
| `x = x + 5`, `x = x - y`, `x += 5`, `-= *= /= %=` | 1, блок сервера, не `%math` |
| `x = x * 2 + 1`, `x = 1 + x` | формула: незаданная `x` обнулит всё |
| `abs sqrt cbrt ceil floor sign wrap sin cos sinr cosr asin acos`, `min(a, b)`, `max(a, b)` | `%math` всегда |
| `x = clamp(a, 0, 9)`, `round(a)`, `pow(a, b)`, `root(a, b)`, `atan2(a, b)`, `min([…])` | блок действия; внутри формулы `%math` |
| формула, `value.x`, `l[0]`, `m["k"]`, `len(l)` в аргументе, формуле, `${}` | 0 лишних |
| `l[i]`, `m[k]`, `@цель value.x` в формуле и `${}` | +1 |
| вызов функции, действие значением | +1 |
| `ok = a > 1`, `c ? a : b` | 2 и больше |
| `[a, 2]`, `{"k": a}`, `["%player%"]`, `loc(a, 0, 0)`, `vec(a, 0, 0)` | +1; постоянные 0 |
| `if a and b` без `else` | вложенные «Если», иначе флаг `__xeroN` |
| `x == 1 or x == 2` | 1 |
| `v + w`, `v - w`, `v / w`, `v * 2`, `2 * v`, `v / 2`, `-v`, `loc + vec`, `vec + loc` | 1, блок действия |
| `loc - vec` | 2: `vec * -1`, сдвиг |

Вектор и место видны из `value.…`, `vec`, `loc`, вида параметра, объявления `game p: location`, результата действия (`rotate_…`, `set_vector_length`, `get_vector_between_locations`, `align_location`, `shift_…`, точка `on_sphere`) и `return vec(…)`. Не вывелось — решает слот результата: `player.teleport(p + vec(0, 1, 0))` собирается сдвигом. Иначе `unknown + vec` — сумма векторов с предупреждением.

## Особые формы

| Запись | Смысл |
|:--|:--|
| `_` командой | пустой блок |
| `literal([a, 2])`, `literal({"k": a})` | как есть, без блока создания |
| `num("%math(…)")` | число текстом |
| `enum("ERROR")`, `enum("SECONDS", u)` | вариант заглавными; привязанный к переменной |
| `raw("{…JSON…}")` | значение как есть; командой — блок с полем `action`, тело по желанию; `имя: raw(…)` — аргумент не из данных |

```kotlin
@hidden
@icon(item(iron_ingot))
@display_name("Имя")
@display_description("Строка 1", "Строка 2")
@description("старое описание")
func info() { }

@line(10)
when player_join { }
```

`when` берёт только `@line` и `@custom_data("текст")` (свой текст строки, до 256 символов): целое, только вперёд, следующие идут за ней. `@display_*`: литералы с одной приставкой или `raw("…")`. `@values("[…JSON…]")` — все значения строки, без других пометок и параметров.

`import "kits.xero"` — файл от текущего. `import "mapi"` — модуль по имени, названию, id, код уходит с проектом. `import "mapi" connect` — через `/module`.

## Ошибки сборки

Приходят все сразу. `возможно, вы имели в виду` — лишь похожее слово, проверяй в `find`. Здесь то, что само не объясняется.

| Сообщение | Причина и правка |
|:--|:--|
| `ожидалось when, func или process…` | снаружи команда, `save x = 0`, лишняя `}`, `def`, `class` |
| `здесь нужна команда, например…` | чужая конструкция: `let x`, `try`, `switch`, `func` в теле, `a.b = 1`, имя без скобок |
| `после команды нужен перевод строки` | две команды в строке, `elif`, `1e3`, `x = y = 1`, `return 1, 2`, `[1][0]`, `p = on_sphere(…) { }` |
| `ожидалась «{»` | тело без скобок, `if a = 1`, `a < b < c`, `@x not c()`, `when e()` |
| `ожидалась «)» или «,»` | нет запятой, `5sec`, `mm "x"`, `"a" "b"`, `0xff` |
| `ожидалось значение, а не «…»` | `x++`, `**`, `+1`, `..<`, строка с оператора |
| `в словаре нужно «ключ: значение»` | `{"a" = 1}`, `=>`, а ещё `repeat { }` без числа |
| `переменная «x» нигде не задана` | опечатка, голое слово вместо текста, условие без `()`, `{hp: 1}`, нет `save x` |
| `цель @x у значения бывает у игрового значения…` | цель перед переменной, числом, функцией |
| `в const только постоянное значение…` | `value`, переменная, `len`, голый ключ `{a: 1}` |
| `не понятно, «q» — список или словарь` | объяви вид: `line q: list` в теле, `game q: map` у игровой, `q: array` у параметра. `f()[n]` сначала в переменную |
| `«N» — постоянная, в ней нет значений по индексу` | индекс у `const` с числом или текстом: нужен список или словарь |
| `условие — это сравнение (x == 1) или…` | `if 5`, `if value.x`, `not x + 1` |
| `лишний аргумент: у «x» их N` | `create_list(1, 2)`, `add(1, 2)`, `append_value(l, 5, 6)`: значения в `[…]`, переменная слева |
| `у «time_unit» нет варианта «u»` | опечатка или переменная нигде не задана |
| `«abc» — не число` | текст в числе, в том числе `s = s + "b"`, `s += "b"` |
| `в «…» and/or нельзя…`, `вызовы, индексы и формулы-условия нельзя…` | в «… по условию» одно условие, значение заранее в переменную |
| `«l» — местоположение, а в формуле только числа` | `loc + 1`, `vec + 1`, `sqrt(v)`: координата — `get_coordinate`, `get_vector_component` |
| `в формуле нет функции «item»`, `это не число для формулы` | значение или `[…]` в `${}`: сначала в переменную |
| `здесь нужно число, а не выражение или переменная` | переменная в `item`, `sound`, `particle`, `potion`: блок `set_*` |
| `здесь нужен текст в кавычках`, `значение тега — текст в кавычках`, `в предмете текст постоянный` | переменная в `name:`, `lore:`, `tags:`: блок `set_item_*` |
| `нет предмета «n» в Minecraft 26.2`, `нет блока`, `нет звука` | опечатка или переменная вместо id |
| `«kind» — переменная, а здесь нужен постоянный id` | `item(kind)`, `block(kind)`: передай переменную без обёртки, тип предмета меняет `set_item_type` |
| `нет игрового значения «y»` | у места части нет своих значений: `get_coordinate(value.location, type: y)` |

## Предупреждения

| Сообщение | Правка |
|:--|:--|
| `«x» — локальная: её задают только в when A, а в when B она пустая` | `game x`; у процесса `local_variables_mode: copy` |
| `«n» в функции «f» — та же локальная…` | `line n` или другое имя |
| `текстовое значение в «число»…`, `«t» — текст: в формуле…` | `convert_text_to_number` |
| `нет плейсхолдера…`, `в %math…` | опечатка: сервер покажет как есть или даст 0 |
| `не понятно, «x» — место или вектор…` | `save x: location`, у параметра `x: location` |
| `«v» — вектор, а в формуле только числа: сервер даст 0` | `v + 1` над результатом действия: блок вектора |
| `в forever нет wait…` | `wait(1)` или выход `break`: сервер остановит цикл |
| `«movement_speed» собирается, но сервер остановит строку…` | голый атрибут: `generic_movement_speed`, `check` с `fix` заменит сам |
| `%var_local(x) читает не параметр…` | `%var_line(x)`. Если нужна одноимённая локальная, оставь и переименуй параметр |
| `«x» — локальная: объявлено похожее имя с другим плейсхолдером` | объявление сравнивается по тексту имени: объяви и это написание |
| `«for» — слово языка…` | другое имя или `` `for` `` |
| `у этой частицы нет цвета…`, `у particle() нет «x»…` | поле не уходит: смотри `find` |

## Как не надо → как надо

| Привычка | В Xero |
|:--|:--|
| `on join`, `def f():`, `class A` | `when player_join { }`, `func f() { }`, словари |
| `let x = 1`, `int x`, `global x` | `x = 1`, `game x` |
| `print("x")`, `sleep(20)` | `send_message("x")`, `wait(20)` |
| `if a: …`, `elif` | `if a == 1 { }`, `else if` |
| `&&`, `\|\|`, `!a` | `and`, `or`, `not a` |
| `x == null`, `x = none` | `var.exists(x)`, `var.remove(x)` |
| `0 < a < 5` | `a in 0..5` |
| `a ** 2`, `x++` | `pow(a, 2)`, `x += 1` |
| `"a" + x`, `s += "b"`, `f"{x}"` | `"a${x}"`, `s = "${s}b"` |
| `str(5)`, `int("5")` | `"${n}"`, `convert_text_to_number("5")` |
| `random(1, 5)` | `random_number(1, 5)` |
| `l.add(x)`, `l.remove(x)`, `l.size()`, `x in l` | `append_value(l, x)`, `remove_list_value(l, x)`, `len(l)`, `x in l` |
| `m.put(k, v)`, `m.get(k)`, `del m[k]` | `m[k] = v`, `m[k]`, `remove_map_entry(m, k)` |
| `s.length`, `"a" in s`, `s.split(" ")` | `text_length(s)`, `text_contains(s, "a")`, `split_text(s, " ")` |
| `player.health`, `event.message` | `value.current_health`, `value.event_chat_message` |
| `teleport(p)`, `remove()` | `player.teleport(p)`, `entity.remove()` |
| `give(player, item)` | `@killer give_items(item(stone))`: игрок — цель, не аргумент |
| `@all value.name` | `all_players()`, `for n in value.selection_target_names { }` |
| `for (i = 0; …)`, `range(5)`, `for i in 5` | `for i in 0..4` |
| `repeat { }`, `loop { }` | `forever { wait(1) }` |
| `return a, b`, `a, b = f()` | `return [a, b]`, `l = f()` |
| `try { } catch { }`, `switch` | `exception(err) { }`, `else if` |
| вектор в списке, который заполняет другой проект: `l[0] * x` собирается формулой и тихо даёт 0 | `game axis: vector`, `axis = l[0]`, потом `axis * x`. Список из векторов в своём коде компилятор узнаёт сам, и `for v in l` тоже |
