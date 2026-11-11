# Целая игра: фазы, раунды, экономика, защита

Рецепты прогнаны на сервере 04.11.2026: 12 из 15. Кирпичи — в других темах: лобби и отсчёт в `loops-ui`, магазин и наборы в `menus-items`, приват в `world-blocks`, лидеры в `commands`. Здесь сборка. Законченных игр в корпусе мало: семейство `queue` (8 модулей), `krug_game`, `randomcode`, `speartennis`. Что не из `SERVER.md`, подтверждено только кодом модулей, проверка — `tests/games.json`.

## Как разделить код
`when` только проверяет, правит список и зовёт функцию. `func` — правила без ожидания. Всё, что ждёт, — `process`: один `match` на матч и помощники с его номером.
```kotlin
const LOBBY = "lobby"
const NEED = 2
const SPAWNS = [loc(30.5, 65, 0.5, 90, 0), loc(-29.5, 65, 0.5, -90, 0)]
game phase
game run
game queue: list
game alive: list
func try_start() {
    if phase == LOBBY and len(queue) >= NEED {
        phase = "count"
        run += 1
        start match(target_mode: no_target)
    }
}
func put_in(at: number, who: text) {
    player_by_name(who)
    @current player.teleport(SPAWNS[remainder(at, get_list_length(SPAWNS))], keep_rotation: false)
    @current give_items(item(iron_sword))
    reset()
}
process match() {
    left = 10
    while left > 0 and len(queue) >= NEED {
        @all send_action_bar("&eСтарт через ${left}")
        wait(1s)
        left -= 1
    }
    if left > 0 or len(queue) < NEED { phase = LOBBY; return }
    phase = "run"
    alive = randomize_list_order(queue)
    queue = []
    for i, nick in alive { put_in(i, nick) }
    start income(run, target_mode: no_target)
    left = 120
    while left > 0 and len(alive) > 1 {
        wait(1s)
        left -= 1
    }
    phase = "end"
    @all send_title("&6Победил ${get_list_value(alive, 0, "никто")}", fade_in: 5, stay: 60, fade_out: 5)
    wait(5s)
    alive = []
    @all set_gamemode(gamemode: adventure)
    phase = LOBBY
    try_start()
}
process income(id: number) {
    wait(15s)
    while run == id and phase == "run" {
        @all send_message("&b+1")
        wait(15s)
    }
}
when world_start {
    phase, run = LOBBY, 0
    queue, alive = [], []
}
```
- `queue` (1173 установки) делает это цепочкой из пяти процессов и опросом раз в секунду. Один процесс читается как сценарий матча, его локальные живут весь матч. Вход: `queue = append_value(value.name)`, `try_start()`. Время матча показывай в том же цикле (боссбар, `mm:ss` — `loops-ui`).
- **Матч заканчивает только `match`.** Снаружи меняют лишь списки: выход игрока правит `alive`, стоп админа — `queue = []`, `alive = []`, цикл выйдет сам за секунду.
- Фаза не даёт запустить второй матч, номер глушит хвосты прошлого: помощник с одной проверкой фазы (`krug_game`: `while status == "game" { wait(15s) … }`) переживёт конец матча, если следующий начнётся раньше его пробуждения, и их станет два. Тот же номер в «Музыке» (`PlayWhile` против `MusicNum`).
- Фазы: `lobby`, `count`, `run`, `end`, `reset`. Меняй фазу до `start` и до первого `wait`: что пойдёт раньше, тело процесса или строка после `start`, не проверено (`gm02`). Сброс карты — вызов `wipe()` перед `phase = "lobby"`.

## `start` и `target_mode`
| Нужно | Запись | Обработчиков / модулей |
|:--|:--|:--|
| Матч, цикл мира | `target_mode: no_target` | 99 / 31 |
| Один процесс на всю выборку | `current_selection` (Прятки: `Пробуждение сикера`) | 23 / 11 |
| Свой процесс каждому | `all_players()`, `start one(target_mode: for_each_in_selection)`, `reset()` | 12 / 10 |
| Продолжить для игрока события | без `target_mode` | |

- `for_each_in_selection`: в теле работают `%player%` и цель без `@`, не нужны `for` и `%var_local(ник)`. Так «Аукцион» обновляет меню всем, кто его смотрит. Цена — N процессов разом, предел `too_many_processes_active`.
- Всем одно и то же: `@all`, процесс не нужен. Участникам: `player_by_conditional(@current value.name in alive)`; короче `player_by_name(alive)` (Компактная очередь, `gm03`). Выборка переживает `wait`, но устаревает: выбирай заново после ожидания.
- Параметр вместо `local_variables_mode: copy`: QMod копирует все локальные ради одной `arena`.

## Вышел посреди раунда
```kotlin
game phase
game run
game queue: list
game alive: list
func drop_out(who: text) {
    queue = remove_list_value(queue, who, remove_mode: all)
    alive = remove_list_value(alive, who, remove_mode: all)
}
process to_watchers(who: text, id: number) {
    wait(1s)
    if run != id { return }
    player_by_name(who)
    if value.selection_size == 0 { return }
    @current set_gamemode(gamemode: spectator)
}
when player_quit { drop_out(value.name) }
when player_kill_player { drop_out("%victim%") }
when player_death {
    drop_out(value.name)
    start to_watchers(value.name, run, target_mode: no_target)
}
when player_rejoin {
    if value.name in alive { cancel_event() }
}
when player_join {
    if phase == "run" { set_gamemode(gamemode: spectator) }
}
```
- Всякое выбывание идёт в одну функцию, повтор безвреден: события приходят парами (`player_death` срабатывает и при убийстве мобом).
- Отложенное — процессом `no_target`, ник и номер параметрами: `%player%` там нет, а игрока может не быть. После `wait` проверяй матч и `value.selection_size`. Что стало с `wait` в `when` вышедшего, не проверено (`krug_game` ждёт так 3 с).
- `/play` — выход без выхода: `player_rejoin` отменяют 23 обработчика из 33. Отменяй только на время боя (`antirelog`), а не всегда (Компактная очередь). Штраф за выход: `antirelog` зовёт `player.damage` в `player_quit`, а в локализации есть ошибка `cant_damage_quit`. Надёжнее запись в `save` и наказание при входе.

| Модуль | Ошибка | Как надо |
|:--|:--|:--|
| `ochered` | `player_kill_player` убирает `value.name`, а это убийца | `"%victim%"` |
| `ochered`, `krug_game` | конец матча зовут и `player_quit`, и таймер, и захват | конец только в `match` |
| `krug_game`, CustomQueue | счётчик рядом со списком разъезжается | `len(список)` |
| `queue` | `@stopgame` стартует `Конец игры`, цикл стартует его снова | снаружи только списки |
| Money and @pay | зачисление, `wait(5)`, списание: вышел — деньги удвоились | обе записи без `wait` |
| CaseAnimOp | приз после анимации: вышел — приз пропал | см. «Кейс» |
| Coins, `gasg` | `монеты = 100000` на каждый вход | `if not var.exists(…)` |

## Очередь и арены
- Лишние ждут следующего матча (`queue`): `alive = trim_list(queue, 0, MAX)`, `queue = trim_list(queue, MAX, размер)`. Вход предметом: тег, запрет выброса (`menus-items`), `set_item_cooldown` от двойного клика.
- Арены (QMod): логика та же, арена в именах переменных, а `` `арена %player%` `` помнит, где игрок. В функции с параметром `a`: `` `очередь %var_line(a)` ``, из `player_quit`: `` `очередь %var(арена %player%)` ``, оба объявить с `: list`. Длина — `get_list_length`, `len` не собирается. Меню арен: тег `arena` на кнопке, статус в `set_item_lore_line`.

## Спавны и сброс карты
```kotlin
save placed: list
game phase
game alive: list
when player_place_block {
    if phase != "run" or value.name not in alive { cancel_event(); end_thread() }
    placed = append_value(value.event_block_location)
}
when player_break_block {
    if value.event_block_location not in placed { cancel_event(); end_thread() }
    placed = remove_list_value(placed, value.event_block_location, remove_mode: all)
}
func wipe() {
    phase = "reset"
    for index, spot in placed {
        set_block(spot, block(air))
        if remainder(index, 200) == 199 { wait(1) }
    }
    placed = []
    entity_by_conditional(has_custom_tag("game", "1"))
    @current entity.remove()
    phase = "lobby"
}
when world_start {
    if not var.exists(placed) { placed = [] }
    wait(1s)
    wipe()
}
```
- Журнал (`randomcode`) заодно защита: ломается только поставленное. `save` доживает падение матча, `world_start` дочистит. Ломаемая карта: эталон рядом и `clone_region(a, b, a, to, ignore_air: false)` срезами с `wait`; так копируют только плоты, арену никто, предел — `too_many_blocks_changed`.
- Точки по кругу, `remainder(i, всего)`, не кончаются. `randomcode` вынимает остров из списка и держится только на том, что `MAX` равен числу островов. Случайная точка: `randomized_teleport(точки)`.
- Своим мобам и визуализаторам — тег, чистка одной выборкой (`case`: `incase`).
- Граница у каждого своя: `set_world_border(центр, размер, 1)`, сужение `shift_world_border(старый, новый, секунды)`, сброс `remove_world_border()`.

## Команды, раунды, волны
```kotlin
game run
func mobs_left() {
    entity_by_conditional(has_custom_tag("game", "1"))
    found = value.selection_size
    reset()
    return found
}
process waves(id: number) {
    for wave in 1..5 {
        repeat wave * 3 {
            spawn_mob(mob: item(zombie_spawn_egg), location: loc(0, 65, 20))
            @last set_custom_tag("game", "1")
        }
        wait(1s)
        while run == id and mobs_left() > 0 { wait(1s) }
        if run != id { return }
    }
}
```
- «Оборона зомби» ставит пять `when player_kill_mob` с `wait` до 200 с: каждое убийство заказывает нового босса. Волна — один процесс, следующая по счёту мобов.
- Победа команды: `team[ник]` живых, `remove_list_duplicates`, остался один цвет — конец. Спавн команды — словарь цвет → место. `Bedwars` и `teams` пишут обработчик на цвет: цвет — значение, а не код.
- Захват (`krug_game`): цикл раз в 15 тиков, `player_by_conditional(is_near(5, точка, ignore_y_axis: false))`, прогресс в боссбаре. Раунды: `for i in 1..ROUNDS`, сложность с потолком (`speartennis`: `min(200, 80 + round * 20)`).

## Награды и экономика
```kotlin
const AMOUNT_PATTERN = "^[1-9][0-9]{0,8}$"
save `деньги %player%`
save `деньги %var_local(to)`
when player_join {
    if not var.exists(`деньги %player%`) { `деньги %player%` = 100 }
}
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@pay" { end_thread() }
    cancel_event()
    to = get_list_value(args, 1, "")
    amount = get_list_value(args, 2, "")
    is_amount = text_matches(AMOUNT_PATTERN, amount, regular_expressions: true)
    if not is_amount { send_message("&cСумма: целое больше нуля"); end_thread() }
    amount = add(amount)
    if to == value.name or not var.exists(`деньги %var_local(to)`) { send_message("&cНет счёта"); end_thread() }
    if `деньги %player%` < amount { send_message("&cНе хватает"); end_thread() }
    `деньги %player%` -= amount
    `деньги %var_local(to)` += amount
    send_message("&aПереведено ${amount}")
}
```
- Награда — в `match` до `alive = []`: `` for nick in alive { `деньги %var_local(nick)` += 50 } ``. Счёт — переменная с ником, начислить можно и вышедшему. Время вышло, живых двое: победитель по счёту, `sort_any_map`.
- `var.exists` вместо `has_player` доводит перевод до офлайна. Money and @pay пропускает `-100`: чужие деньги уходят к тебе.
- Деньги матча — `game`, обнулить на старте; вечные — `save`. Списывай ту же цену, что проверил: `krug_game` проверяет `price`, снимает `decrement(1)`.
- Прокачка: `lvl = get_map_value_single(уровни, key, 0)`, цена `floor(base * pow(1.5, lvl))`, потолок, списание, `уровни[key] = lvl + 1`. `drochka_sim` держит цену каждого улучшения в своей `save`, четыре копии с `increment(3.7)`: цена из уровня правится в одном месте.

## Кейс
```kotlin
const LOOT = [item(coal, 8), item(iron_ingot, 4), item(diamond)]
const CHANCE = [70, 25, 5]
save `ключи %player%`
save `приз %player%`
func roll(chances: list) {
    total = 0
    for weight in chances { total += weight }
    hit = random_number(0, total, integer: false)
    cumulative = 0
    for index, weight in chances {
        cumulative += weight
        if hit <= cumulative { return index }
    }
    return 0
}
func claim() {
    if has_player(value.uuid) and var.exists(`приз %player%`) {
        give_items(`приз %player%`)
        var.remove(`приз %player%`)
    }
}
func open_case() {
    if var.exists(`приз %player%`) { return }
    if `ключи %player%` < 1 { send_message("&cНет ключа"); return }
    `ключи %player%` -= 1
    `приз %player%` = LOOT[roll(CHANCE)]
    start spin()
}
process spin() {
    tape = []
    repeat 30 { tape = append_value(LOOT[roll(CHANCE)]) }
    tape[26] = `приз %player%`
    show_inventory_menu(name: "Кейс", custom_id: "spin")
    set_inventory_menu_item(item(hopper, name: "&eВыигрыш"), 4)
    for pos in 0..22 {
        if value.open_inventory_custom_id != "spin" { break }
        for cell in 0..8 { set_inventory_menu_item(tape[pos + cell], 9 + cell) }
        play_sound(sound(block.note_block.hat))
        wait(1 + floor(pos / 6))
    }
    claim()
}
when player_join { claim() }
when player_click_inventory {
    if value.open_inventory_custom_id == "spin" { cancel_event() }
}
```
- Порядок: проверка, списание, розыгрыш, запись в `save`; анимация только показывает решённое. Вышел, закрыл меню, упал мир: приз придёт в `claim` (`has_player` не даст стереть его, если игрока уже нет), незабранный не даст открыть второй кейс. В модулях наоборот: CaseAnimOp решает в последнем кадре, `roulette` читает слот 13 после анимации и открывает закрытое меню заново.
- Вес — `case`. Лента — `roulette`: окно из 9 клеток по списку, приз заранее там, где окно встанет (`pos + 4 == 26`, слот 13). Замедление — растущий `wait` (CaseAnimOp).
- В мире (`case`): `spawn_item_display`, на шаг `set_display_interpolation(6, 0)`, `set_display_rotation_from_axis_angle(vec(0, 1, 0), 90, mode: add)`, `wait(6)`, высота звука `set_sound_pitch`. Сущностям тег, блок занят — флаг по месту, снимается и в `player_quit`.

## Опыт и квесты
```kotlin
const QUESTS = {"jump": {"need": 10, "pay": 50}, "kill": {"need": 5, "pay": 100}}
save `деньги %player%`
save `xp %player%`
save `lvl %player%`
save `квест %player%`: map
func add_xp(amount: number) {
    `xp %player%` += amount
    while `xp %player%` >= 100 * (`lvl %player%` + 1) {
        `xp %player%` -= 100 * (`lvl %player%` + 1)
        `lvl %player%` += 1
    }
    set_experience(`lvl %player%`, mode: level)
}
func quest_add(kind: text, amount: number) {
    have = get_map_value_single(`квест %player%`, kind, 0)
    if have < 0 { return }
    have += amount
    if have >= QUESTS[kind]["need"] {
        `деньги %player%` += QUESTS[kind]["pay"]
        send_advancement(item(emerald), "Задание выполнено", frame: goal)
        have = -1
    }
    `квест %player%`[kind] = have
}
when player_join {
    if not var.exists(`xp %player%`) {
        `xp %player%`, `lvl %player%` = 0, 0
        `квест %player%` = {}
    }
}
when player_jump { quest_add("jump", 1) }
when player_kill_mob { quest_add("kill", 1) }
```
- Квестов нет ни в одном модуле, схема своя: таблица в `const`, прогресс словарём, `-1` — награда выдана, хук одной строкой. Ежедневные: сравни `format_timestamp(value.timestamp, "yyyy-MM-dd", format: custom)` с сохранённым днём и очисти словарь.
- `while`: награда перепрыгивает уровни. Начальные значения обязательны, незаданная обнуляет формулу. Шкала опыта только показ: `set_experience(level, mode: level)` (17 модулей).

## Защита и античит
```kotlin
const MAX_VIOLATIONS = 10
game `vl %player%`
game `cps_t %player%`
game `cps %player%`
func flag(why: text, points: number) {
    `vl %player%` += points
    player_by_conditional(has_privilege(privilege: whitelisted))
    @current send_message("&c[AC] ${value.name} ${why} ${`vl %player%`}/${MAX_VIOLATIONS}")
    reset()
    if `vl %player%` >= MAX_VIOLATIONS and not has_privilege(privilege: owner) { kick() }
}
when player_damage_player {
    if locations_distance(value.location, @victim value.location) > 4.5 { flag("reach", 3) }
}
when player_left_click {
    sec = floor(value.server_current_tick / 20)
    if `cps_t %player%` != sec {
        `cps_t %player%` = sec
        `cps %player%` = 0
    }
    `cps %player%` += 1
    if `cps %player%` > 20 { flag("cps", 1) }
}
```
- Запрет по умолчанию (`queue`): `player_take_damage`, `player_damage_player`, `player_food_level_change` отменяются для `value.name not in alive`; в ударе проверь и `"%victim%"`. Падение: `player_location_change`, `value.y_coordinate < -2`, `player.damage(9999)` (`speartennis`).
- Встроенный `player_anticheat_flag` работает только в рекомендованных мирах, в корпусе 1 модуль. Свои проверки ошибаются: очки, спад раз в 10 с, сообщение админам, а не кик с первого раза. Пороги 4.5 и 20 на живых игроках не проверены (у `mx_anticheat` 3.4 с буфером).
- `mx_anticheat`: буфер на проверку, рост при подозрении, спад, общий `vl`. Плохо: `vl` не убывает, 43 переменные на игрока в `player_move`, а KillAura меряет паузы `value.timestamp` с точностью в секунду: бери `value.server_current_tick`.
- «Защита от читов» сравнивает `value.walking_speed`: это атрибут, у читера он обычный. Скорость — расстояние между замерами раз в секунду, после своего `player.teleport` замер пропусти. Владелец и оператор не кикаются: ошибки `cant_kick_owner`, `cant_kick_op`.

## Чужой код целиком не копируй
«Начало игры» и «Простая очередь» — копии `queue` с закладкой `WORLD CRASHED` в `player_interact`, `player_join`, `player_quit`. «Ломай блок с мистиками» держит `@admintools` по никам и шлёт выходы в Telegram, `krug_game` шлёт весь чат в Discord. Бери приём, а не строку.
