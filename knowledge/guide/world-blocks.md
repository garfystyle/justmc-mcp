# Мир, блоки, местоположения, веб-запросы
Числа 170/45 — использований/модулей в корпусе из 486 модулей. Умолчания маркеров — из данных сервера. Пороги из модулей — наблюдение, а не предел сервера.
## Поставить блоки, заполнить и скопировать область
```kotlin
const WALL = block(stone_bricks)
func room(center: location, radius: number) {
    first_corner = shift_all_coordinates(center, -radius, -radius, -radius)
    second_corner = shift_all_coordinates(center, radius, radius, radius)
    set_region(WALL, first_corner, second_corner)
    clear_region(shift_all_coordinates(first_corner, 1, 1, 1), shift_all_coordinates(second_corner, -1, -1, -1))
    set_block(center, block(sea_lantern), update_blocks: true)
    replace_blocks_in_region(first_corner, second_corner, block(glass), [WALL, block(dirt)])
}
```
- Порядок аргументов разный: `set_region(блок, first_corner, second_corner)` (170/45), `replace_blocks_in_region(first_corner, second_corner, новый, старые)` (23/19, старых до 10), `clear_region(first_corner, second_corner)` (40/21). Углы — в любом порядке.
- Блок — `block(stone)`, предмет (`value.main_hand_item`) или текст. Состояние только текстом: `"light[level=10]"`, `"grass_block[snowy=true]"`; `block("…[…]")` не собирается. `set_block` (132/54) берёт до 14 мест: `set_block([a, b], …)`. `update_blocks` по умолчанию выключен, включают его 10 вызовов из 132.
- Проверка — `game.block_equals(блоки, место)` (99/37): блоки первыми, до 26 вариантов, `["air", "cave_air"]`. Не сравнивай id через `==`: модули не уверены в приставке `minecraft:` и проверяют обе формы. `get_block_material(l)` (44/27) даёт id. `value_type: id_with_data` — со состоянием (`text_contains(d, "half=top")`), `item` — предмет для выдачи, `name` — ключ `block.minecraft.air`.
- Копия: `clone_region(a, b, a, to, ignore_air: false, copy_entity: false)` (29/18). Третий аргумент — точка области, которая ляжет на четвёртый. Умолчания: воздух пропускается, сущности копируются, поэтому копия без `ignore_air: false` не стирает старое на месте вставки.
## Выделить область инструментом
```kotlin
game `pos1 %player%`
game `pos2 %player%`
when player_interact {
    if is_holding(item(wooden_axe)) {
        if value.event_interaction == "left_click_block" {
            `pos1 %player%` = value.event_block_location
        } else if value.event_interaction == "right_click_block" {
            `pos2 %player%` = value.event_block_location
        }
        cancel_event()
    }
}
```
- Так устроены WorldEdit-модули, самые установленные в каталоге: точки в `game` с `%player%`, команда в `player_chat`, блок из руки: `set_region(value.main_hand_item, …)`. Перед этим проверь `var.exists` обеих точек и `has_privilege(privilege: builder)`; есть ещё `whitelisted`, `owner`.
- Модули часто берут `player_left_click` и `player_right_click` по отдельности; один `player_interact` короче. Варианты `value.event_interaction`: `left_click_block`, `right_click_block`, `left_click_air`, `right_click_air`, `physical`. При клике по воздуху блоку события не верят: WENoLimits проверяет `var.is_type(value.event_block_location, location)`.
## Обойти блоки и не уронить мир
```kotlin
const PER_TICK = 1000
const CPU_MAX = 70
func pace() {
    steps += 1
    if steps >= PER_TICK {
        steps = 0
        wait(1)
    }
    while value.cpu_usage >= CPU_MAX {
        wait(1)
    }
}
func ball(center: location, radius: number, ball_block: block) {
    low = shift_all_coordinates(center, -radius, -radius, -radius)
    high = shift_all_coordinates(center, radius, radius, radius)
    on_grid(point, low, high) {
        if location_is_near(point, radius, center) {
            set_block(point, ball_block)
        }
        pace()
    }
}
func fill_big(ball_block: block, first_point: location, second_point: location) {
    low_x = min([get_coordinate(first_point, type: x), get_coordinate(second_point, type: x)])
    high_x = max([get_coordinate(first_point, type: x), get_coordinate(second_point, type: x)])
    for x in low_x..high_x {
        set_region(ball_block, set_coordinate(first_point, x, type: x), set_coordinate(second_point, x, type: x))
        wait(1)
        pace()
    }
}
```
- Сервер останавливает код: «Цикл выполнил слишком много итераций за один тик», «Выполнено слишком много действий за один тик», «Изменено слишком много блоков», «Высокое использование процессора…», «Строчка события выполнялась слишком долго». Чисел в данных нет. Одной проверки CPU мало: быстрый цикл упрётся в итерации, поэтому `pace` считает и шаги. Шагов за тик в модулях — от 200 до 5000 (worldedit). Блоков на вызов `set_region`: worldedit — 37000, WENoLimits — 50000.
- `while value.cpu_usage >= 70` лучше `if` (в корпусе 12 и 26): `if` ждёт тик и идёт дальше под нагрузкой. Порог — 70 (MAPI), 80–85 (worldedit, генераторы). `value.cpu_usage` — 0–100 (55/32), `value.server_tps` — 0–20 (8/7). `fill_big` режет по X срезом в 1 блок. Срез больше ~37000 блоков — двойной цикл по X и Z с шагом `floor(sqrt(37000 / высота))`, как в worldedit.
- `ball`: `center` — целый угол блока (`align_location(l, rotation_mode: remove, align_mode: corner)`), иначе шар может съехать на полблока: worldedit поэтому прибавляет 0.5. Модули считают `pow` по трём осям на клетку; одно условие `location_is_near` короче. Параллельный запуск защищай флагом в `game`: занято → `end_thread()`. Ошибка оставит флаг поднятым до перезапуска мира.
## Отреагировать на сломанный или поставленный блок
```kotlin
const ORE = block(iron_ore)
when player_break_block {
    if event_block_equals(ORE) {
        spot = value.event_block_location
        give_items(item(raw_iron))
        wait(5s)
        set_block(spot, ORE)
    }
}
```
- `value.event_block_location` — сам блок события, его центр. `value.target_block_location` — блок под взглядом: модули берут его и здесь (14 против 9 в `player_break_block`), но смысл другой, а если взгляд в небо, OSC проверяет его через `var.is_type`. `cancel_event()` ставь до любого `wait`: в корпусе почти всегда так.
- В `player_place_block` блок — `event_block_equals`, предмет — `value.main_hand_item`. Клетка рядом с кликнутой: `shift_location_on_vector(value.event_block_location, get_vector_from_block_face(value.event_block_face))`. Privates делает это словарём и разбором текста — лишнее. Кирка 3×3×3 (612 установок): `clear_region` вокруг места, без добычи. С добычей: `break_block([a, b], value.main_hand_item)`, до 16 мест.
## Защитить зону, приват
```kotlin
save zones
when world_start {
    if not var.exists(zones) {
        zones = create_list()
    }
}
func guard(at: location) {
    for z in zones {
        if z["owner"] != value.name and location_in_range(at, z["a"], z["b"], border_handling: block) {
            cancel_event()
            send_action_bar("&cПриват игрока ${z["owner"]}")
            return
        }
    }
}
when player_break_block {
    guard(value.event_block_location)
}
```
- Новая зона: `zones = append_value({"a": a, "b": b, "owner": value.name})`. Тот же `guard` зови из `player_place_block` и из `player_interact`, если `value.event_interaction` на блоке (двери, сундуки). Privates копирует обход в каждый обработчик; функция одна.
- Проверки: блок — `location_in_range(l, a, b, border_handling: block)` (умолчание `exact` не округляет до блока), игрок — `player.in_area(a, b, ignore_y_axis: false)`, радиус — `is_near(r, c, ignore_y_axis: false)`, сущность — `is_near_location`, переменная — `location_is_near(l, r, c, shape: cube)`. **`ignore_y_axis` по умолчанию включён**: `is_near` и `in_area` без него проверяют столб на всю высоту. Поэтому 20 из 26 `is_near` его выключают.
- Без игрока: `block_explode`, `entity_explode`, `block_burn`, `block_piston_extend`, `block_piston_retract`, `tnt_prime` — по `cancel_event()` в каждом (Мощный Анти гриф). Запрет взаимодействия: `player_interact`, `if not gamemode_equals(gamemode: creative) { cancel_event() }`.
## Посчитать местоположения
```kotlin
func points() {
    feet = align_location(value.location, rotation_mode: remove)
    above = shift_coordinate(feet, 3, type: y)
    ahead = shift_location_in_direction(value.eye_location, 5)
    sea = set_coordinate(feet, 63, type: y)
    get_all_coordinates(above, x, y, z)
    send_message("${x} ${y} ${z}, до точки ${locations_distance(feet, ahead)}")
    set_block([ahead, sea], block(glowstone))
}
```
- `value.location` — ноги с поворотом, `value.eye_location` — глаза. `align_location` без маркеров — центр блока, поворот сохраняется; `align_mode: corner` — целые координаты. `loc(x, 64, z)` и `vec(a, 0, b)` принимают и переменные. Сдвиг: `shift_all_coordinates(l, dx, dy, dz)` (186/34).
- **`l + vec(0, 1, 0)`** собирается в `shift_location_on_vector`, если `l` известен как место: `value.…`, `loc(…)`, постоянная, параметр `: location`, результат действия вроде `align_location`, `shift_…`. Переменную из другого кода объяви: `game base: location`. Иначе компилятор предупредит и сложит как векторы.
- У `shift_coordinate`, `set_coordinate`, `get_coordinate` умолчание `type: x`: `shift_coordinate(l, 1)` сдвигает X. Пиши `type:` всегда. `get_vector_between_locations(a, b)` — из `a` в `b`, только по порядку: имена аргументов у сервера перепутаны. `locations_distance(a, b, type: two_d)` — без высоты. `random_location(a, b)` по умолчанию целый. Место в тексте печатается как JSON: выводи координаты.
## Телепорт, точки, спавн
```kotlin
const LOBBY = loc(0.5, 65, 0.5, 180, 0)
func to_lobby() {
    player.teleport(LOBBY, keep_rotation: false)
}
when player_respawn {
    wait(1)
    to_lobby()
}
```
- В `player_join`: `set_spawn_point(LOBBY)` и `to_lobby()`. **`keep_rotation` по умолчанию включён**: поворот из `loc(…, yaw, pitch)` не применится без `keep_rotation: false` (29 вызовов из 90). Телепорт закрывает открытое меню. `wait` в начале `player_respawn` советует описание события. Мгновенное возрождение — `set_instant_respawn()`. Пустота: `player_take_damage` + `damage_cause_equals(cause: void)`, там `cancel_event()` и телепорт.
- Другой игрок: `player_by_name(nick)`, потом `@current player.teleport(value.location)` (к себе) или `@default player.teleport(@current value.location, keep_rotation: false)` (к нему).
- Точки: `save warps`, в `world_start` `warps = create_map()`, запись `warps[name] = value.location`, переход `if name in warps { player.teleport(warps[name], keep_rotation: false) }`. Имя из команды — `get_list_value(args, 1, "")`: `args[1]` без слова остановит строку. `value.spawn_location` — спавн мира, `value.origin` — первое появление.
## Зона-триггер на player_move
```kotlin
const ZONE_MIN = loc(10, 60, 10)
const ZONE_MAX = loc(20, 70, 20)
game `в зоне %player%`
when player_move {
    if player.in_area(ZONE_MIN, ZONE_MAX, ignore_y_axis: false) {
        if `в зоне %player%` != 1 {
            `в зоне %player%` = 1
            send_title("&aВы вошли в зону")
        }
    } else if `в зоне %player%` == 1 {
        `в зоне %player%` = 0
        send_title("&cВы вышли из зоны")
    }
}
```
- `player_move` (32/25) срабатывает на каждый переход с блока на блок. Без флага действие повторяется на каждом шаге.
- Никаких `wait`, `while`, `forever` внутри: каждый шаг запускает новую копию (blood_gore13, pulemet), а активные «Ждать» сервер ограничивает: «Превышен лимит количества активных действий "Ждать"». Первой строкой — дешёвая проверка. Поиск сущностей на каждый шаг (`entity_by_name` в SitANDLay) держи за условием.
- Зона для всех и редко: `process` с `forever { wait(10) … }` и `player_by_conditional(player.in_area(a, b, ignore_y_axis: false))`, потом `@current …`. Плитка-триггер: `player.is_standing_on_block(block(gold_block))`.
## Время, погода, режим, настройки мира
```kotlin
when world_start {
    set_world_time(6000)
    set_world_gamerule("false", gamerule: do_daylight_cycle)
    set_world_weather(12000, weather_type: clear)
    set_world_difficulty(difficulty: peaceful)
    set_block_drops_enabled(enable: false)
}
```
- Значение `set_world_gamerule` — текст, пустое сбрасывает правило. Это действие и `set_block_drops_enabled` в корпусе не встречаются. `set_world_weather` без длительности погоду не меняет (описание сервера), единица длительности в данных не указана. Читать: `value.world_time`, `value.world_weather` (`clear`, `rain`, `thunder`). Погода меняется не сразу: через 2 тика значение ещё старое, через 40 уже новое.
- Одному игроку: `set_time(18000)`, `set_weather(weather_type: clear)` — в `player_join`, в `world_start` игрока нет. **`set_weather()` без маркера включает дождь.** `set_gamemode()` без маркера — выживание, пиши `gamemode:` явно (92/41, чаще всего в `player_join`). Проверка — `gamemode_equals(gamemode: creative)`, текстом — `value.gamemode`.
## Веб-запрос и JSON
```kotlin
const API = "https://api.binance.com/api/v3/avgPrice?symbol=BTCUSDT"
game asker
func ask_price() {
    asker = value.name
    send_web_request(API)
}
when world_web_response {
    if value.url == API {
        data = parse_json(value.url_response)
        player_by_name(asker)
        @current send_message("BTC: ${data["price"]}")
    }
}
when world_web_exception {
    @all send_message("&cЗапрос не прошёл")
}
```
- `world_web_response` — событие мира: игрока нет, локальные запроса не видны. Контекст — в `game`, адресат — выборка или `@all`. Несколько запросов разводи по `value.url`: из 14 модулей это делают 5. `world_web_exception` и `value.url_response_code` в корпусе не встречаются, в модулях сбой молчит. В игре их работа не проверялась.
- JSON: `parse_json(value.url_response)` (9/8), потом `data["key"]`. Простой текст: `split_text(value.url_response, "\n")`.
- POST: `send_web_request(url, to_json({"name": value.name}), {"Accept": "application/json"}, request_type: post, content_type: application_json)`. Часть модулей склеивает JSON текстом, а кавычка в сообщении такую склейку ломает. Умолчание — GET и `text/plain`. Пробел в адресе: `replace_text(q, " ", "%20")`.
- Опрос — в секундах: BitCoinPrice ждёт 10 с, а `wait(2)` в telegramm — это 2 тика. Ошибки сервера: «Достигнут лимит по количеству веб-запросов» (значения в данных нет), «Указанный URL веб-запроса не может быть запрошен». Токен не пиши в код: lomai_bloc держит токен бота прямо в модуле, и его видит каждый, кто видит код.
## Частые ошибки
- `x = min(a, b)`, `"${max(a, b)}"` и `1 + max(a, b)` — формула. `min([a, b])` со списком — действие. Граница — `clamp(v, lo, hi)`.
- `loc(x, 64, z)` с переменными собирается блоком. Сдвиг готового места проще: `l + vec(0, 1, 0)`.
- `game.block_equals(место, блок)` и `set_region(a, b, блок)` — обратный порядок. `on_grid` или `for` по блокам без `wait`; цикл с `wait` внутри `player_move`.
- `send_message` без цели в `world_start` и `world_web_response`: нужен `@all` или выборка.
- Умолчания маркеров: `type: x`, `ignore_y_axis`, `keep_rotation`, `ignore_air`, `set_weather()`, `set_gamemode()`. Если смысл важен, пиши маркер явно.
- Чтение раньше записи: `set_region(…, pos1, pos2)` до `var.exists`, `for z in zones` до `create_list()`.
